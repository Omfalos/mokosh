import { createImportMap, type Graph } from "../index";

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
  private readonly configuredRoots = new Set<string>();

  /** Returns true if `applyConfig` has already been called for `root` this session. */
  isConfigured(root: string): boolean {
    return this.configuredRoots.has(root);
  }

  /** Records that config has been applied for `root` so it is not applied again. */
  markConfigured(root: string): void {
    this.configuredRoots.add(root);
  }

  /**
   * Returns the cached graph for `root`, or builds a new one from `entryPoints`.
   *
   * When a prior graph exists it is forwarded to `createImportMap` for
   * incremental rebuilding — unchanged files are reused based on mtime + size
   * comparison, keeping subsequent calls fast on large codebases.
   */
  async getOrBuild(root: string, entryPoints: string[]): Promise<Graph> {
    const graph = await createImportMap(root, entryPoints, this.graphs.get(root) ?? null);
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
}
