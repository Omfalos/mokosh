import type { MokoshConfig } from "../config";
import { createImportMap, createWorkspaceGraph, type Graph, type WorkspaceGraph } from "../index";

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

  /** Returns true if `applyConfig` has already been called for `root` this session. */
  isConfigured(root: string): boolean {
    return this.configs.has(root);
  }

  /** Stores the loaded config for `root` (replaces markConfigured). */
  storeConfig(root: string, config: MokoshConfig): void {
    this.configs.set(root, config);
  }

  /** Returns the stored config for `root`, or undefined if not yet configured. */
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

  /** Returns true when a workspace graph (not a single-package graph) is cached for `root`. */
  hasWorkspace(root: string): boolean {
    return this.workspaceGraphs.has(root);
  }

  /**
   * @description Drops the cached graph and workspace graph for `root`, forcing the next
   *   `analyze` call to rebuild from disk. Config is preserved. Use after editing source
   *   files mid-session to ensure subsequent queries reflect the updated state.
   * @param root - Absolute path of the project root to invalidate.
   * @returns `true` if a cached graph existed and was removed, `false` if nothing was cached.
   */
  invalidate(root: string): boolean {
    const had = this.graphs.has(root) || this.workspaceGraphs.has(root);
    this.graphs.delete(root);
    this.workspaceGraphs.delete(root);
    return had;
  }
}
