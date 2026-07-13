/** Session-scoped graph cache keyed by root directory, shared across MCP tool calls in one session. */
import fs, { type FSWatcher } from "node:fs";
import type { MokoshConfig } from "../config";
import {
  buildChangeImpactCache,
  type ChangeImpactCache,
  createImportMap,
  createWorkspaceGraph,
  type Graph,
  type WorkspaceGraph,
} from "../index";
import { IGNORE_WATCH } from "../watch-ignore";

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
  private readonly changeImpactCaches = new Map<string, ChangeImpactCache>();
  private readonly dirtyRoots = new Set<string>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly lastAnalyze = new Map<string, LastAnalyzeArgs>();

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
   * When a prior graph exists it is forwarded to `createImportMap` for
   * incremental rebuilding — unchanged files are reused based on mtime + size
   * comparison, keeping subsequent calls fast on large codebases.
   */
  async getOrBuild(
    root: string,
    entryPoints: string[],
    coverageMap: Map<string, number> = new Map(),
  ): Promise<Graph> {
    const config = this.configs.get(root);
    const graph = await createImportMap(root, entryPoints, this.graphs.get(root) ?? null, {
      gitStats: config?.gitStats ?? false,
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
   * @description Builds (or returns the cached) workspace graph for a monorepo root.
   *   Workspace graphs are never incrementally updated — a fresh build is triggered when
   *   the cache is empty for this root.
   */
  async getOrBuildWorkspace(
    root: string,
    options: { packages?: string[]; silent?: boolean; gitStats?: boolean } = {},
  ): Promise<WorkspaceGraph> {
    const cached = this.workspaceGraphs.get(root);
    if (cached) return cached;
    const wg = await createWorkspaceGraph(root, options);
    this.workspaceGraphs.set(root, wg);
    return wg;
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
    const existing = this.changeImpactCaches.get(root);
    if (existing) return existing;
    const graph = this.require(root);
    const cache = buildChangeImpactCache(graph);
    this.changeImpactCaches.set(root, cache);
    return cache;
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
    this.changeImpactCaches.delete(root);
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
    if (!this.dirtyRoots.has(root)) return this.requireWorkspace(root);
    this.dirtyRoots.delete(root);
    this.changeImpactCaches.delete(root);
    this.workspaceGraphs.delete(root);
    const config = this.configs.get(root);
    return this.getOrBuildWorkspace(root, { gitStats: config?.gitStats ?? false });
  }

  /**
   * @description Drops the cached graph, workspace graph, and change impact cache for `root`,
   *   forcing the next `analyze` call to rebuild from disk. Config is preserved. Use after
   *   editing source files mid-session to ensure subsequent queries reflect the updated state.
   * @param root - Absolute path of the project root to invalidate.
   * @returns `true` if a cached graph existed and was removed, `false` if nothing was cached.
   */
  invalidate(root: string): boolean {
    const had = this.graphs.has(root) || this.workspaceGraphs.has(root);
    this.graphs.delete(root);
    this.workspaceGraphs.delete(root);
    this.changeImpactCaches.delete(root);
    this.dirtyRoots.delete(root);
    return had;
  }
}
