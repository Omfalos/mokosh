/** Session-scoped graph cache keyed by root directory, shared across MCP tool calls in one session. */
import crypto from "node:crypto";
import fs, { type FSWatcher } from "node:fs";
import path from "node:path";
import type { MokoshConfig } from "../config";
import { loadWorkspaceCache, saveWorkspaceCache } from "../graph/workspace/disk-cache";
import {
  buildChangeImpactCache,
  type ChangeImpactCache,
  computeWorkspaceSourceDigest,
  configToGraphOptions,
  createImportMap,
  createWorkspaceGraph,
  DEFAULT_CACHE_DIR,
  DEFAULT_DUPLICATION_RESULT_CACHE_FILE,
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_GRAPH_CACHE_FILE,
  type DuplicationTokenCache,
  detectMonorepo,
  type FlatWorkspaceGraph,
  Graph,
  loadTokenCacheFromDisk,
  type MonorepoLayout,
  type ParallelParsingOption,
  packageOwnsFile,
  saveTokenCacheToDisk,
  type WorkspaceGraph,
  type WorkspacePackage,
} from "../index";
import { IGNORE_WATCH } from "../watch-ignore";

/** Where the disk-persisted `find_duplicates` token cache for `root` lives — shared with the
 *  CLI's `mokosh-cache/` directory (`src/cli/graph-loader.ts`) so a CLI run and an MCP session
 *  against the same root warm each other's cache. */
function duplicationTokenCachePath(root: string): string {
  return path.join(root, DEFAULT_CACHE_DIR, DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
}

/** Where the disk-persisted `find_duplicates` *result* cache for `root` lives — the full
 *  `{ groups, clusters }` from the last scan, digest-gated (see
 *  `src/graph/duplication/result-cache-store.ts`). Honors the same `mokosh.config.*` `cachePath`
 *  override as the graph cache. On a monorepo, pass `pkgName` for a per-package file so one
 *  package's edits don't invalidate every other package's cached result. */
function resolveDuplicationResultCachePath(
  root: string,
  config: MokoshConfig | undefined,
  pkgName?: string,
): string {
  const dir = config?.cachePath
    ? path.dirname(path.resolve(root, config.cachePath))
    : path.join(root, DEFAULT_CACHE_DIR);
  if (!pkgName) return path.join(dir, DEFAULT_DUPLICATION_RESULT_CACHE_FILE);
  const slug = crypto.createHash("sha1").update(pkgName).digest("hex").slice(0, 8);
  return path.join(dir, `duplication-result-${slug}.json`);
}

/** Where the CLI's disk-persisted graph cache for `root` lives, honoring the same
 *  `mokosh.config.*` `cachePath` override the CLI itself resolves against
 *  (`src/cli/config.ts`'s `resolveCachePath`) — falls back to `<root>/mokosh-cache/graph.json`. */
function graphCachePath(root: string, config: MokoshConfig | undefined): string {
  return config?.cachePath
    ? path.resolve(root, config.cachePath)
    : path.join(root, DEFAULT_CACHE_DIR, DEFAULT_GRAPH_CACHE_FILE);
}

/** The resolved `mokosh-cache` directory for `root` (honoring a `mokosh.config.*` `cachePath`
 *  override) — the workspace graph cache lives in its `workspace/` subdir as a manifest plus one
 *  file per package (`src/graph/workspace/disk-cache.ts`). */
function workspaceCacheDir(root: string, config: MokoshConfig | undefined): string {
  return config?.cachePath
    ? path.dirname(path.resolve(root, config.cachePath))
    : path.join(root, DEFAULT_CACHE_DIR);
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
  const owned = new Map([...graph.nodes].filter(([nodePath]) => packageOwnsFile(nodePath, pkg)));
  return new Graph(owned);
}

/**
 * @description Narrows a {@link FlatWorkspaceGraph} to just the nodes owned by `pkgName`,
 *   keeping the `packageOf` entries in sync. Used when a whole-workspace tool is scoped to one
 *   package via a `package` arg.
 * @param flat - The flattened workspace graph.
 * @param pkgName - The package to keep.
 * @returns A new `FlatWorkspaceGraph` containing only that package's nodes.
 */
function restrictFlatToPackage(flat: FlatWorkspaceGraph, pkgName: string): FlatWorkspaceGraph {
  const nodes = new Map(
    [...flat.graph.nodes].filter(([nodePath]) => flat.packageOf.get(nodePath) === pkgName),
  );
  const packageOf = new Map([...flat.packageOf].filter(([nodePath]) => nodes.has(nodePath)));
  return { graph: new Graph(nodes), packageOf };
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
  /** Whole-tree source digest (`computeWorkspaceSourceDigest`) each cached workspace graph was
   *  built/hydrated from — lets `ensureFreshWorkspace` skip a full rebuild when a file-watcher
   *  event turns out to be incidental churn (editor swap file, git index) that changed nothing. */
  private readonly workspaceDigests = new Map<string, string>();
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
   *   On a cold start the graph is hydrated from `<root>/mokosh-cache/workspace/` (a manifest
   *   plus one file per package) when every package's per-package digest still matches the live
   *   tree; `forceFresh` skips that (used after the file watcher flags a real change).
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
    const cacheDir = workspaceCacheDir(root, this.configs.get(root));
    const { digest, files } = computeWorkspaceSourceDigest(root);

    const hydrated = forceFresh ? null : loadWorkspaceCache(cacheDir, files);
    if (hydrated) {
      this.workspaceGraphs.set(root, hydrated);
      this.workspaceDigests.set(root, digest);
      return hydrated;
    }

    const build = createWorkspaceGraph(root, {
      ...buildOptions,
      layout: this.getLayout(root),
      projectFiles: files,
    })
      .then((workspaceGraph) => {
        this.workspaceGraphs.set(root, workspaceGraph);
        this.workspaceDigests.set(root, digest);
        saveWorkspaceCache(cacheDir, files, workspaceGraph, (message) =>
          process.stderr.write(`Warning: ${message}\n`),
        );
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
   * @description `getAffected`'s `cached: true` entry point: resolves the right change-impact
   *   cache for `file` — root-keyed on a plain root, `${root}::__flat__`-keyed on a workspace
   *   root (one cache over the flattened whole-workspace graph, matching `resolveGraphForFile`).
   * @param root - Absolute project root path.
   * @param file - Root-relative path the impact cache is queried for; used only to validate the
   *   owning package on a workspace root.
   * @param graph - The already-resolved `Graph` for `file` (from `resolveGraphForFile`, i.e. the
   *   flattened graph on a workspace root), reused here instead of re-resolving.
   * @returns The `ChangeImpactCache` to query.
   */
  async getOrBuildChangeImpactForFile(
    root: string,
    file: string,
    graph: Graph,
  ): Promise<ChangeImpactCache> {
    if (!this.isWorkspaceRoot(root)) return this.getOrBuildChangeImpactFor(root, () => graph);
    const wg = await this.ensureFreshWorkspace(root);
    if (!wg.getPackageForFile(file)) {
      throw new Error(
        `No workspace package owns "${file}". Call get_workspace_packages to list packages.`,
      );
    }
    return this.getOrBuildChangeImpactFor(`${root}::__flat__`, () => graph);
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
   *   it returns the flattened whole-workspace graph (`WorkspaceGraph.flatten()`), so blast
   *   radius, callers and dependency traversal from `file` cross package boundaries. Still
   *   validates that some package owns `file`.
   * @param root - Absolute project root path.
   * @param file - Root-relative path of the file the query is about.
   * @returns The `Graph` to query.
   * @throws {Error} if `analyze` was never called for `root`, or (on a workspace root) no
   *   package owns `file`.
   */
  async resolveGraphForFile(root: string, file: string): Promise<Graph> {
    return (await this.resolveFlatGraphForFile(root, file)).graph;
  }

  /**
   * @description Like {@link resolveGraphForFile} but also returns the `path → package name`
   *   lookup, for handlers that annotate their results with each file's owning package.
   * @param root - Absolute project root path.
   * @param file - Root-relative path of the file the query is about.
   * @returns The graph to query and its package lookup (`packageOf` empty on a plain root).
   * @throws {Error} if `analyze` was never called, or no package owns `file` on a workspace root.
   */
  async resolveFlatGraphForFile(root: string, file: string): Promise<FlatWorkspaceGraph> {
    if (!this.isWorkspaceRoot(root)) {
      return { graph: await this.ensureFresh(root), packageOf: new Map() };
    }
    const wg = await this.ensureFreshWorkspace(root);
    if (!wg.getPackageForFile(file)) {
      throw new Error(
        `No workspace package owns "${file}". Call get_workspace_packages to list packages.`,
      );
    }
    return wg.flatten();
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
   * @description Resolves the single `Graph` a whole-workspace tool should run against, plus a
   *   `path → package name` lookup. On a plain (non-monorepo) root this is exactly
   *   `ensureFresh`'s graph with an empty `packageOf`, so single-package behavior is unchanged.
   *   On a workspace root it is `WorkspaceGraph.flatten()` — every package's own nodes merged
   *   into one namespace with cross-package edges intact — optionally narrowed to `pkg`.
   *   Unlike `resolveGraphs`, callers do not fan out or concatenate: they run their existing
   *   single-`Graph` logic once and annotate results with `packageOf`.
   * @param root - Absolute project root path.
   * @param pkg - Optional workspace package name to restrict the flattened graph to.
   * @returns The graph to query and its package lookup.
   * @throws {Error} if `analyze` was never called for `root`, or `pkg` names an unknown package.
   */
  async resolveFlatGraph(root: string, pkg?: string): Promise<FlatWorkspaceGraph> {
    if (!this.isWorkspaceRoot(root)) {
      return { graph: await this.ensureFresh(root), packageOf: new Map() };
    }
    const wg = await this.ensureFreshWorkspace(root);
    const flat = wg.flatten();
    if (pkg) {
      if (!wg.packages.has(pkg)) {
        throw new Error(
          `Unknown workspace package "${pkg}". Call get_workspace_packages to list packages.`,
        );
      }
      return restrictFlatToPackage(flat, pkg);
    }
    return flat;
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

    // The file watcher fires on any fs event under `root` — editor swap files, a git index
    // write, `.DS_Store` — most of which change no source file. A full non-incremental
    // `createWorkspaceGraph` over every package is expensive enough on a large monorepo to
    // exhaust the heap, so only rebuild when the whole-tree source digest actually moved.
    const cached = this.workspaceGraphs.get(root);
    if (cached) {
      const { digest } = computeWorkspaceSourceDigest(root);
      if (digest === this.workspaceDigests.get(root)) return cached;
    }

    this.clearChangeImpactCachesFor(root);
    const previousWorkspace = this.workspaceGraphs.get(root);
    this.workspaceGraphs.delete(root);
    this.workspaceDigests.delete(root);
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
   * @description Absolute path to `root`'s disk-persisted `find_duplicates` *result* cache — the
   *   full `{ groups, clusters }` from the last scan, digest-gated (see
   *   `src/graph/duplication/result-cache-store.ts`). Pass `pkgName` on a monorepo to get a
   *   per-package file. Honors the same `mokosh.config.*` `cachePath` override the graph cache
   *   does. This only resolves the path — `handleFindDuplicates` owns the load/save.
   * @param root - Absolute project root path.
   * @param pkgName - Workspace package name, when the scan is scoped to one package.
   * @returns The path the result cache for this `(root, package)` should be read from / written to.
   */
  duplicationResultCachePath(root: string, pkgName?: string): string {
    return resolveDuplicationResultCachePath(root, this.configs.get(root), pkgName);
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
    this.workspaceDigests.delete(root);
    this.workspaceBuilds.delete(root);
    this.layouts.delete(root);
    this.clearChangeImpactCachesFor(root);
    this.dirtyRoots.delete(root);
    this.duplicationTokenCaches.delete(root);
    this.configs.delete(root);
    return had;
  }
}
