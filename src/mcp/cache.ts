/** Session-scoped graph cache keyed by root directory, shared across MCP tool calls in one session. */
import fs, { type FSWatcher } from "node:fs";
import path from "node:path";
import type { MokoshConfig } from "../config";
import {
  buildChangeImpactCache,
  type ChangeImpactCache,
  computeWorkspaceSourceDigest,
  configToGraphOptions,
  createImportMap,
  createWorkspaceGraph,
  DEFAULT_CACHE_DIR,
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_GRAPH_CACHE_FILE,
  DEFAULT_WORKSPACE_GRAPH_CACHE_FILE,
  type DuplicationTokenCache,
  detectMonorepo,
  Graph,
  loadTokenCacheFromDisk,
  type MonorepoLayout,
  type ParallelParsingOption,
  type SerializedWorkspaceGraph,
  saveTokenCacheToDisk,
  WorkspaceGraph,
  type WorkspacePackage,
} from "../index";
import { IGNORE_WATCH } from "../watch-ignore";

/** Where the disk-persisted `find_duplicates` token cache for `root` lives — shared with the
 *  CLI's `mokosh-cache/` directory (`src/cli/graph-loader.ts`) so a CLI run and an MCP session
 *  against the same root warm each other's cache. */
function duplicationTokenCachePath(root: string): string {
  return path.join(root, DEFAULT_CACHE_DIR, DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
}

/** Where the CLI's disk-persisted graph cache for `root` lives, honoring the same
 *  `mokosh.config.*` `cachePath` override the CLI itself resolves against
 *  (`src/cli/config.ts`'s `resolveCachePath`) — falls back to `<root>/mokosh-cache/graph.json`. */
function graphCachePath(root: string, config: MokoshConfig | undefined): string {
  return config?.cachePath
    ? path.resolve(root, config.cachePath)
    : path.join(root, DEFAULT_CACHE_DIR, DEFAULT_GRAPH_CACHE_FILE);
}

/** Where the disk-persisted *workspace* graph for `root` lives — the cache directory (derived
 *  from the same `cachePath` override) plus `workspace-graph.json`. */
function workspaceGraphCachePath(root: string, config: MokoshConfig | undefined): string {
  const cacheDir = config?.cachePath
    ? path.dirname(path.resolve(root, config.cachePath))
    : path.join(root, DEFAULT_CACHE_DIR);
  return path.join(cacheDir, DEFAULT_WORKSPACE_GRAPH_CACHE_FILE);
}

/**
 * @description Hydrates a persisted workspace graph from disk, but only if its stored source
 *   digest still matches the live tree. Never throws — a missing/corrupt/foreign/stale file
 *   degrades to `null` (a full rebuild), never a wrong answer.
 * @param cachePath - Path written by {@link saveWorkspaceDiskCache}.
 * @param expectedDigest - Current `computeWorkspaceSourceDigest` result for the root.
 * @returns The deserialized `WorkspaceGraph`, or `null`.
 */
function loadWorkspaceDiskCache(cachePath: string, expectedDigest: string): WorkspaceGraph | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as {
      digest?: string;
      graph?: SerializedWorkspaceGraph;
    };
    if (!parsed.graph || parsed.digest !== expectedDigest) return null;
    return WorkspaceGraph.deserialize(parsed.graph);
  } catch {
    return null;
  }
}

/**
 * @description Persists a built workspace graph plus the source digest it was built from. Never
 *   throws: a write failure (read-only fs, etc.) is logged to stderr and otherwise ignored.
 * @param cachePath - Destination file.
 * @param digest - The digest the graph was built against.
 * @param wg - The workspace graph to serialize.
 */
function saveWorkspaceDiskCache(cachePath: string, digest: string, wg: WorkspaceGraph): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ digest, graph: wg.serialize() }));
  } catch (err) {
    process.stderr.write(`Warning: failed to persist workspace graph cache: ${err}\n`);
  }
}

/**
 * @description Reads and deserializes a CLI-written graph cache from disk, for seeding a
 *   session's first `analyze` call. Never throws: a missing file, malformed JSON, or a value
 *   that fails to deserialize all degrade to `null` (today's cold-start behavior) rather than
 *   failing the tool call that triggered the read — this is pure acceleration, and
 *   `createImportMap` re-validates every seeded node against the live filesystem (mtime+size)
 *   before trusting it, so a stale or foreign cache file can only cost a re-parse, never produce
 *   wrong data.
 * @param cachePath - Path to the JSON file written by `saveGraphToCache` (`src/cli/graph-loader.ts`).
 * @returns The deserialized `Graph`, or `null` if nothing usable was found.
 */
function loadDiskGraphSeed(cachePath: string): Graph | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, "utf-8");
    return Graph.deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * @description Builds a `Graph` containing only the nodes that fall under `pkg`'s own
 *   `relativeRoot`. Each package's `Graph` (built independently by `createWorkspaceGraph`) also
 *   contains a node for every cross-package file it imports — needed so traversal from within
 *   that package reaches them — but a whole-graph tool fanning out across every package must not
 *   list those borrowed nodes as if they belonged here too, or a file imported by two packages
 *   would be double-reported. Used by `resolveGraphs`; not by `resolveGraphForFile`, whose
 *   traversal-based tools (get_dependencies et al.) need those borrowed nodes reachable.
 * @param graph - A workspace package's own `Graph`.
 * @param pkg - That package's metadata, for its `relativeRoot` prefix.
 * @returns A new `Graph` restricted to nodes under `pkg.relativeRoot`.
 */
function restrictToOwnFiles(graph: Graph, pkg: WorkspacePackage): Graph {
  const owned = new Map(
    [...graph.nodes].filter(
      ([path]) => path === pkg.relativeRoot || path.startsWith(`${pkg.relativeRoot}/`),
    ),
  );
  return new Graph(owned);
}

type LastAnalyzeArgs =
  | { kind: "single"; entryPoints: string[]; coverageMap: Map<string, number> }
  | { kind: "workspace" };

/**
 * Per-session state keyed by absolute project root path.
 *
 * Holds both the parsed dependency graphs and config-initialisation bookkeeping
 * so all tool calls within one MCP session can share the same in-memory state
 * without re-parsing or re-applying config on every request.
 *
 * Each `createMcpServer()` call creates its own `SessionState`, keeping
 * parallel server instances (e.g. in tests) fully isolated.
 */
export class SessionState {
  private readonly graphs = new Map<string, Graph>();
  private readonly configs = new Map<string, MokoshConfig>();
  private readonly workspaceGraphs = new Map<string, WorkspaceGraph>();
  private readonly layouts = new Map<string, MonorepoLayout>();
  private readonly workspaceBuilds = new Map<string, Promise<WorkspaceGraph>>();
  private readonly changeImpactCaches = new Map<string, ChangeImpactCache>();
  private readonly dirtyRoots = new Set<string>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly lastAnalyze = new Map<string, LastAnalyzeArgs>();
  private readonly duplicationTokenCaches = new Map<string, DuplicationTokenCache>();

  /**
   * @description Returns `true` if config has already been loaded and applied for `root` this session.
   * @param {string} root - Absolute project root path.
   * @returns {boolean} `true` if config was previously stored for this root.
   */
  isConfigured(root: string): boolean {
    return this.configs.has(root);
  }

  /**
   * @description Stores the loaded config for `root` so subsequent tool calls can read it without re-loading.
   * @param {string} root - Absolute project root path.
   * @param {MokoshConfig} config - The parsed config to store.
   */
  storeConfig(root: string, config: MokoshConfig): void {
    this.configs.set(root, config);
  }

  /**
   * @description Returns the stored config for `root`, or `undefined` if not yet configured.
   * @param {string} root - Absolute project root path.
   * @returns {MokoshConfig | undefined} The previously stored config, or `undefined`.
   */
  getConfig(root: string): MokoshConfig | undefined {
    return this.configs.get(root);
  }

  /**
   * Returns the cached graph for `root`, or builds a new one from `entryPoints`.
   *
   * When a prior graph exists (from an earlier call this session) it is forwarded to
   * `createImportMap` for incremental rebuilding — unchanged files are reused based on mtime +
   * size comparison, keeping subsequent calls fast on large codebases. On this session's *first*
   * call for `root`, with nothing in memory yet, falls back to seeding from the CLI's on-disk
   * graph cache (`<root>/mokosh-cache/graph.json` by default — see `loadDiskGraphSeed`) if one
   * exists, so a fresh MCP session against a root the CLI already analyzed starts warm instead of
   * parsing cold.
   */
  async getOrBuild(
    root: string,
    entryPoints: string[],
    coverageMap: Map<string, number> = new Map(),
  ): Promise<Graph> {
    const config = this.configs.get(root);
    const previousGraph = this.graphs.get(root) ?? loadDiskGraphSeed(graphCachePath(root, config));
    const graph = await createImportMap(root, entryPoints, previousGraph, {
      ...configToGraphOptions(config),
      coverageMap,
    });
    this.graphs.set(root, graph);
    return graph;
  }

  /**
   * Returns the cached graph for `root`.
   *
   * @throws {Error} if `analyze` has not been called for this root in the
   *   current session — mirrors the tool-level requirement.
   */
  require(root: string): Graph {
    const graph = this.graphs.get(root);
    if (!graph) throw new Error('No graph cached for this root. Call "analyze" first.');
    return graph;
  }

  /**
   * @description Returns the monorepo layout for `root`, running `detectMonorepo` at most once
   *   per session. `detectMonorepo` walks every Gradle/sbt module on a JVM monorepo, so both
   *   `handleAnalyze` and `handleGetWorkspacePackages` sharing this result matters.
   * @param root - Absolute project root path.
   * @returns The (memoized) `MonorepoLayout`.
   */
  getLayout(root: string): MonorepoLayout {
    const cached = this.layouts.get(root);
    if (cached) return cached;
    const layout = detectMonorepo(root);
    this.layouts.set(root, layout);
    return layout;
  }

  /**
   * @description Builds (or returns the cached) workspace graph for a monorepo root.
   *   Workspace graphs are never incrementally updated — a fresh build is triggered when
   *   the cache is empty for this root. A build already in flight for `root` (e.g. a
   *   concurrent `analyze` + `get_workspace_affected`) is awaited rather than started again.
   *   On a cold start the graph is hydrated from `<root>/mokosh-cache/workspace-graph.json`
   *   when its stored source digest still matches the live tree; `forceFresh` skips that
   *   (used after the file watcher flags a change).
   */
  async getOrBuildWorkspace(
    root: string,
    options: {
      packages?: string[] | undefined;
      silent?: boolean;
      gitStats?: boolean;
      parallelParsing?: ParallelParsingOption | undefined;
      pathAliases?: Record<string, string[]> | undefined;
      additionalIgnoreDirs?: string[] | undefined;
      forceFresh?: boolean;
      previousWorkspace?: WorkspaceGraph | undefined;
    } = {},
  ): Promise<WorkspaceGraph> {
    const cached = this.workspaceGraphs.get(root);
    if (cached) return cached;

    const inFlight = this.workspaceBuilds.get(root);
    if (inFlight) return inFlight;

    const { forceFresh, ...buildOptions } = options;
    const cachePath = workspaceGraphCachePath(root, this.configs.get(root));
    const { digest, files } = computeWorkspaceSourceDigest(root);

    const hydrated = forceFresh ? null : loadWorkspaceDiskCache(cachePath, digest);
    if (hydrated) {
      this.workspaceGraphs.set(root, hydrated);
      return hydrated;
    }

    const build = createWorkspaceGraph(root, {
      ...buildOptions,
      layout: this.getLayout(root),
      projectFiles: files,
    })
      .then((workspaceGraph) => {
        this.workspaceGraphs.set(root, workspaceGraph);
        saveWorkspaceDiskCache(cachePath, digest, workspaceGraph);
        return workspaceGraph;
      })
      .finally(() => {
        this.workspaceBuilds.delete(root);
      });
    this.workspaceBuilds.set(root, build);
    return build;
  }

  /**
   * @description Returns the cached workspace graph for `root`.
   * @throws {Error} if `analyze` has not been called for this monorepo root.
   */
  requireWorkspace(root: string): WorkspaceGraph {
    const wg = this.workspaceGraphs.get(root);
    if (!wg) throw new Error('No workspace graph cached for this root. Call "analyze" first.');
    return wg;
  }

  /**
   * @description Returns `true` when a workspace graph (not a single-package graph) is cached for `root`.
   * @param {string} root - Absolute monorepo root path to check.
   * @returns {boolean} `true` if a workspace graph exists in the cache for this root.
   */
  hasWorkspace(root: string): boolean {
    return this.workspaceGraphs.has(root);
  }

  /**
   * @description Returns the change impact cache for `root`, building it lazily on first access.
   *   The cache pre-computes all incoming traversals so `get_change_impact` queries are O(1).
   *   Requires a prior `analyze` call to ensure the graph is available.
   * @param root - Absolute project root path.
   * @returns The `ChangeImpactCache` for this root.
   */
  getOrBuildChangeImpact(root: string): ChangeImpactCache {
    return this.getOrBuildChangeImpactFor(root, () => this.require(root));
  }

  /**
   * @description Returns the change impact cache keyed by `cacheKey`, building it lazily via
   *   `buildGraph` on first access. `getOrBuildChangeImpact` is the `root`-keyed convenience
   *   wrapper around this; workspace-scoped callers (`resolveGraphForFile` consumers) key by
   *   `${root}::${packageName}` instead, so each package gets its own impact cache rather than
   *   one built over a merged graph.
   * @param cacheKey - Cache key — `root` for a single-package graph, `${root}::${packageName}` for a workspace package.
   * @param buildGraph - Lazily supplies the `Graph` to build the cache from, only called on a miss.
   * @returns The `ChangeImpactCache` for this key.
   */
  private getOrBuildChangeImpactFor(cacheKey: string, buildGraph: () => Graph): ChangeImpactCache {
    const existing = this.changeImpactCaches.get(cacheKey);
    if (existing) return existing;
    const cache = buildChangeImpactCache(buildGraph());
    this.changeImpactCaches.set(cacheKey, cache);
    return cache;
  }

  /**
   * @description Change-impact-cache variant of `getOrBuildChangeImpact` for a specific workspace
   *   package, keyed by `${root}::${packageName}` so each package's cache is independent.
   * @param root - Absolute monorepo root path.
   * @param packageName - The owning package's name, from `WorkspaceGraph.getPackageForFile`.
   * @param graph - That package's `Graph`, already resolved by the caller.
   * @returns The `ChangeImpactCache` for this package.
   */
  getOrBuildChangeImpactForPackage(
    root: string,
    packageName: string,
    graph: Graph,
  ): ChangeImpactCache {
    return this.getOrBuildChangeImpactFor(`${root}::${packageName}`, () => graph);
  }

  /**
   * @description `getAffected`'s `cached: true` entry point: resolves the right change-impact
   *   cache for `file` — root-keyed on a plain root, `${root}::${packageName}`-keyed on a
   *   workspace root (so each package's cache stays independent, never a merged one).
   * @param root - Absolute project root path.
   * @param file - Root-relative path the impact cache is queried for; used only to resolve the
   *   owning package on a workspace root.
   * @param graph - The already-resolved `Graph` for `file` (from `resolveGraphForFile`), reused
   *   here instead of re-resolving.
   * @returns The `ChangeImpactCache` to query.
   */
  async getOrBuildChangeImpactForFile(
    root: string,
    file: string,
    graph: Graph,
  ): Promise<ChangeImpactCache> {
    if (!this.isWorkspaceRoot(root)) return this.getOrBuildChangeImpactFor(root, () => graph);
    const wg = await this.ensureFreshWorkspace(root);
    const pkg = wg.getPackageForFile(file);
    if (!pkg) {
      throw new Error(
        `No workspace package owns "${file}". Call get_workspace_packages to list packages.`,
      );
    }
    return this.getOrBuildChangeImpactFor(`${root}::${pkg.name}`, () => graph);
  }

  /**
   * @description Drops every change-impact cache entry for `root` — the root-keyed entry (single-
   *   package graphs) and every `${root}::${packageName}` entry (workspace packages).
   * @param root - Absolute project root path.
   */
  private clearChangeImpactCachesFor(root: string): void {
    this.changeImpactCaches.delete(root);
    const prefix = `${root}::`;
    for (const key of this.changeImpactCaches.keys()) {
      if (key.startsWith(prefix)) this.changeImpactCaches.delete(key);
    }
  }

  /**
   * @description Returns `true` if the last `analyze` call for `root` auto-detected a monorepo
   *   and built a workspace graph, rather than a single-package graph from explicit entry points.
   * @param root - Absolute project root path.
   * @returns {boolean} `true` if `root` should be queried through its per-package `WorkspaceGraph`.
   */
  isWorkspaceRoot(root: string): boolean {
    return this.lastAnalyze.get(root)?.kind === "workspace";
  }

  /**
   * @description Resolves the `Graph` a file-scoped query (one `file` argument) should run
   *   against. On a plain (non-monorepo) root this is exactly `ensureFresh`. On a workspace root
   *   it resolves the package that owns `file` via `WorkspaceGraph.getPackageForFile` and returns
   *   that package's own `Graph` — never a merged whole-repo graph.
   * @param root - Absolute project root path.
   * @param file - Root-relative path of the file the query is about.
   * @returns The `Graph` to query.
   * @throws {Error} if `analyze` was never called for `root`, or (on a workspace root) no
   *   package owns `file`.
   */
  async resolveGraphForFile(root: string, file: string): Promise<Graph> {
    if (!this.isWorkspaceRoot(root)) return this.ensureFresh(root);
    const wg = await this.ensureFreshWorkspace(root);
    const pkg = wg.getPackageForFile(file);
    if (!pkg) {
      throw new Error(
        `No workspace package owns "${file}". Call get_workspace_packages to list packages.`,
      );
    }
    const entry = wg.packages.get(pkg.name);
    if (!entry) throw new Error(`Workspace package "${pkg.name}" has no graph built.`);
    return entry.graph;
  }

  /**
   * @description Resolves the `Graph`(s) a whole-graph query should run against, one entry per
   *   package. On a plain (non-monorepo) root, returns a single entry (`package: ""`) — exactly
   *   `ensureFresh`'s graph, so single-package behavior and output shape are unchanged. On a
   *   workspace root: with `pkg` given, returns just that package's `Graph`; omitted, returns
   *   every package's `Graph` so the caller can fan out and concatenate its own per-package
   *   results — no graph is ever merged here.
   * @param root - Absolute project root path.
   * @param pkg - Optional workspace package name to restrict to.
   * @returns The graph(s) to query, each paired with its owning package name (`""` when not a workspace).
   * @throws {Error} if `analyze` was never called for `root`, or `pkg` names an unknown package.
   */
  async resolveGraphs(
    root: string,
    pkg?: string,
  ): Promise<Array<{ package: string; graph: Graph }>> {
    if (!this.isWorkspaceRoot(root)) {
      const graph = await this.ensureFresh(root);
      return [{ package: "", graph }];
    }
    const wg = await this.ensureFreshWorkspace(root);
    if (pkg) {
      const entry = wg.packages.get(pkg);
      if (!entry) {
        throw new Error(
          `Unknown workspace package "${pkg}". Call get_workspace_packages to list packages.`,
        );
      }
      return [{ package: pkg, graph: restrictToOwnFiles(entry.graph, entry.pkg) }];
    }
    return Array.from(wg.packages.entries()).map(([name, { graph, pkg: pkgMeta }]) => ({
      package: name,
      graph: restrictToOwnFiles(graph, pkgMeta),
    }));
  }

  /**
   * @description Records the arguments used in the last `analyze` call for `root` so the watcher
   *   can trigger an incremental rebuild using the same parameters when source files change.
   * @param root - Absolute project root path.
   * @param args - The kind of analysis performed (single-package or workspace) and its options.
   */
  storeLastAnalyze(root: string, args: LastAnalyzeArgs): void {
    this.lastAnalyze.set(root, args);
  }

  /**
   * @description Returns the entry points used in the last single-package `analyze` call for
   *   `root`, so a follow-up tool call (e.g. `compare_branches`) can rebuild an equivalent graph
   *   at a different ref without the caller having to repeat them. `undefined` for a workspace
   *   root or one that was never analyzed.
   * @param root - Absolute project root path.
   * @returns The stored entry points, or `undefined`.
   */
  getLastEntryPoints(root: string): string[] | undefined {
    const args = this.lastAnalyze.get(root);
    return args?.kind === "single" ? args.entryPoints : undefined;
  }

  /**
   * @description Starts an `fs.watch` listener on `root` (recursive, ignoring `node_modules`,
   *   `.git`, `dist`, `build`, and `coverage` directories). When any source file changes, marks
   *   `root` as dirty so the next query transparently triggers an incremental rebuild.
   *   Safe to call multiple times — a second call for the same root is a no-op.
   * @param root - Absolute path of the directory to watch.
   */
  startWatching(root: string): void {
    if (this.watchers.has(root)) return;
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename || IGNORE_WATCH.test(filename)) return;
        this.dirtyRoots.add(root);
      });
      watcher.on("error", () => {
        this.watchers.delete(root);
      });
      this.watchers.set(root, watcher);
    } catch {
      // Degrade gracefully on unsupported filesystems or permission errors.
    }
  }

  /**
   * @description Returns a fresh graph for `root`, rebuilding incrementally if source files changed
   *   since the last `analyze` call. Acts as a drop-in replacement for `require` in query handlers.
   * @param root - Absolute project root path.
   * @returns The up-to-date `Graph` for this root.
   * @throws {Error} if `analyze` has never been called for this root.
   */
  async ensureFresh(root: string): Promise<Graph> {
    if (!this.dirtyRoots.has(root)) return this.require(root);
    this.dirtyRoots.delete(root);
    this.clearChangeImpactCachesFor(root);
    const args = this.lastAnalyze.get(root);
    if (args?.kind === "single") {
      return this.getOrBuild(root, args.entryPoints, args.coverageMap);
    }
    return this.require(root);
  }

  /**
   * @description Returns a fresh workspace graph for `root`, rebuilding if source files changed.
   *   Acts as a drop-in replacement for `requireWorkspace` in workspace query handlers.
   * @param root - Absolute monorepo root path.
   * @returns The up-to-date `WorkspaceGraph` for this root.
   * @throws {Error} if `analyze` has never been called for this root.
   */
  async ensureFreshWorkspace(root: string): Promise<WorkspaceGraph> {
    if (!this.dirtyRoots.has(root)) {
      const cached = this.workspaceGraphs.get(root);
      if (cached) return cached;
      // Progressive `analyze` returns before building; the first workspace query that needs
      // edges triggers the build here.
      return this.getOrBuildWorkspace(root, configToGraphOptions(this.configs.get(root)));
    }
    this.dirtyRoots.delete(root);
    this.clearChangeImpactCachesFor(root);
    const previousWorkspace = this.workspaceGraphs.get(root);
    this.workspaceGraphs.delete(root);
    const config = this.configs.get(root);
    return this.getOrBuildWorkspace(root, {
      ...configToGraphOptions(config),
      forceFresh: true,
      previousWorkspace,
    });
  }

  /**
   * @description Returns the `find_duplicates` token cache for `root`. On first access this
   *   session, hydrates from `<root>/mokosh-cache/duplication-tokens.json` on disk if present
   *   (see `token-cache-store.ts`) instead of starting empty — this is what lets a fresh MCP
   *   session's first `find_duplicates` call skip re-tokenizing files unchanged since the cache
   *   was last written by any prior session, or by a CLI run against the same root. Persists
   *   across calls within a session so unchanged files (by `mtime`/`size`) skip re-tokenizing —
   *   see docs/adr-014-duplicate-detection-scale.md. Cleared (in-memory only) by `invalidate`, since a
   *   rebuilt graph may have re-parsed files whose `mtime`/`size` happen to collide with stale
   *   entries in edge cases (e.g. a restored backup); starting empty after invalidation is cheap
   *   insurance against that, not a response to a known bug. The on-disk file is left alone by
   *   `invalidate` — the same per-entry mtime/size check that guards this cache within a session
   *   also self-corrects any stale disk entries the next time this method hydrates from it.
   * @param root - Absolute project root path.
   * @returns The mutable token cache for this root.
   */
  async getDuplicationTokenCache(root: string): Promise<DuplicationTokenCache> {
    let cache = this.duplicationTokenCaches.get(root);
    if (!cache) {
      cache = loadTokenCacheFromDisk(duplicationTokenCachePath(root));
      this.duplicationTokenCaches.set(root, cache);
    }
    return cache;
  }

  /**
   * @description Persists `root`'s in-memory `find_duplicates` token cache to disk, so the next
   *   MCP session (or a CLI run against the same root) starts warm instead of tokenizing cold.
   *   Call after a `find_duplicates` call completes — see `handleFindDuplicates`. Never throws: a
   *   write failure (e.g. a read-only filesystem) is logged to stderr and otherwise ignored,
   *   since this is a pure performance optimization and must never fail the tool call that
   *   triggered it.
   * @param root - Absolute project root path.
   */
  flushDuplicationTokenCache(root: string): void {
    const cache = this.duplicationTokenCaches.get(root);
    if (!cache) return;
    try {
      saveTokenCacheToDisk(cache, duplicationTokenCachePath(root));
    } catch (err) {
      process.stderr.write(`Warning: failed to persist duplication token cache: ${err}\n`);
    }
  }

  /**
   * @description Drops the cached graph, workspace graph, change impact cache, and loaded
   *   config for `root`, forcing the next `analyze` call to rebuild from disk — including
   *   re-reading `mokosh.config.json`, since `handleAnalyze` only loads config once per root
   *   (guarded by `isConfigured`). Without dropping config here, editing `mokosh.config.json`
   *   mid-session and calling `clear_cache` would rebuild the graph but keep applying the
   *   stale config. Use after editing source files (or config) mid-session to ensure
   *   subsequent queries reflect the updated state.
   * @param root - Absolute path of the project root to invalidate.
   * @returns `true` if a cached graph existed and was removed, `false` if nothing was cached.
   */
  invalidate(root: string): boolean {
    const had = this.graphs.has(root) || this.workspaceGraphs.has(root);
    this.graphs.delete(root);
    this.workspaceGraphs.delete(root);
    this.workspaceBuilds.delete(root);
    this.layouts.delete(root);
    this.clearChangeImpactCachesFor(root);
    this.dirtyRoots.delete(root);
    this.duplicationTokenCaches.delete(root);
    this.configs.delete(root);
    return had;
  }
}
