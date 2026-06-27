/** Graph class wrapping the raw node map with DFS traversal, cycle detection, serialization, and reverse-edge helpers. */
import type { SerializedGraph, TraversalOptions, TraversalVisitor } from "../types/graph";
import type { CallEdge, FileNode } from "../types/node";
import { GraphAnalyzer } from "./analyzer";

/**
 * @description Represents the dependency graph of the project.
 *   Wraps the raw node map with traversal, cycle detection, serialization, and
 *   reverse-index helpers. All node paths are project-relative strings.
 */
export class Graph {
  private _incomingEdgesCache: Map<string, string[]> | null = null;
  private _callIncomingCache: Map<string, string[]> | null = null;

  /**
   * @param {Map<string, FileNode>} nodes - All parsed file nodes, keyed by project-relative path.
   */
  constructor(public nodes: Map<string, FileNode>) {}

  /**
   * @description Serializes the graph into a plain JSON-compatible object
   *   that can be written to disk and later restored via `deserialize`.
   * @returns {SerializedGraph} A flat representation of all nodes in the graph.
   */
  public serialize(): SerializedGraph {
    return {
      nodes: Array.from(this.nodes.values()),
    };
  }

  /**
   * @description Reconstructs a Graph from a serialized snapshot, rebuilding
   *   the internal node map keyed by file path.
   * @param {SerializedGraph} serialized - The plain object produced by `serialize`.
   * @returns {Graph} A fully functional Graph instance.
   */
  public static deserialize(serialized: SerializedGraph): Graph {
    const nodes = new Map<string, FileNode>();
    for (const node of serialized.nodes) {
      nodes.set(node.path, node);
    }
    return new Graph(nodes);
  }

  /**
   * @description Lazily builds and caches a reverse index mapping each file path
   *   to the list of files that import it. Used internally for incoming traversal.
   * @returns {Map<string, string[]>} Map from target file path to list of importer file paths.
   */
  private getIncomingEdgesMap(): Map<string, string[]> {
    if (this._incomingEdgesCache) return this._incomingEdgesCache;
    const incoming = new Map<string, string[]>();
    for (const node of this.nodes.values()) {
      for (const imp of node.imports) {
        if (imp.toPath) {
          const list = incoming.get(imp.toPath) || [];
          list.push(node.path);
          incoming.set(imp.toPath, list);
        }
      }
    }
    this._incomingEdgesCache = incoming;
    return incoming;
  }

  /**
   * @description Core DFS engine. Visits each reachable node once, calling visitor at each step.
   *   The caller provides a getNeighbors function so the same loop works for any edge type.
   * @param startPath - Project-relative path of the node to start from.
   * @param visitor - Called for each visited node; return `false` to prune the branch.
   * @param options - `maxDepth` and `direction` (direction is interpreted by the caller's getNeighbors).
   * @param getNeighbors - Returns the next paths to visit from a given path.
   */
  private dfs(
    startPath: string,
    visitor: TraversalVisitor,
    options: TraversalOptions,
    getNeighbors: (path: string) => string[],
  ) {
    const visited = new Set<string>();
    const maxDepth = options.maxDepth ?? Infinity;

    const walk = (currentPath: string, depth: number, parentPath: string | null) => {
      if (depth > maxDepth || visited.has(currentPath)) return;
      const node = this.nodes.get(currentPath);
      if (!node) return;
      visited.add(currentPath);
      if (visitor(node, depth, parentPath) === false) return;
      for (const neighbor of getNeighbors(currentPath)) {
        walk(neighbor, depth + 1, currentPath);
      }
    };

    walk(startPath, 0, null);
  }

  /**
   * @description Performs a DFS on the import dependency graph.
   *   Supports both outgoing and incoming (reverse) traversal.
   * @param startPath - Project-relative path of the node to start from.
   * @param visitor - Callback executed for each node; return `false` to stop traversing a branch.
   * @param options - Configuration for `maxDepth` and `direction`.
   */
  public traverse(startPath: string, visitor: TraversalVisitor, options: TraversalOptions = {}) {
    const direction = options.direction ?? "outgoing";
    const incoming = direction === "incoming" ? this.getIncomingEdgesMap() : null;
    this.dfs(startPath, visitor, options, (path) =>
      direction === "outgoing"
        ? ((this.nodes
            .get(path)
            ?.imports.map((importEdge) => importEdge.toPath)
            .filter(Boolean) as string[]) ?? [])
        : (incoming?.get(path) ?? []),
    );
  }

  /**
   * @description Builds and caches a reverse index of call edges: target file path → list of
   *   source file paths whose exported functions call into it. Computed lazily on first access
   *   and reused for the lifetime of this Graph instance.
   * @returns {Map<string, string[]>} Map from target file path to list of source file paths that call into it.
   */
  private getCallIncomingCache(): Map<string, string[]> {
    if (this._callIncomingCache) return this._callIncomingCache;
    const cache = new Map<string, string[]>();
    for (const node of this.nodes.values()) {
      for (const edge of node.callEdges ?? []) {
        const list = cache.get(edge.toFile) ?? [];
        list.push(node.path);
        cache.set(edge.toFile, list);
      }
    }
    this._callIncomingCache = cache;
    return cache;
  }

  /**
   * @description Performs a DFS over call edges (exported-function → imported-symbol).
   *   Outgoing follows callEdges forward; incoming follows the reverse call index.
   * @param startPath - Project-relative path of the node to start from.
   * @param visitor - Callback executed for each node; return `false` to stop traversing a branch.
   * @param options - Configuration for `maxDepth` and `direction`.
   */
  public traverseCalls(
    startPath: string,
    visitor: TraversalVisitor,
    options: TraversalOptions = {},
  ) {
    const direction = options.direction ?? "outgoing";
    const callIncoming = direction === "incoming" ? this.getCallIncomingCache() : null;
    this.dfs(startPath, visitor, options, (path) =>
      direction === "outgoing"
        ? (this.nodes.get(path)?.callEdges?.map((callEdge) => callEdge.toFile) ?? [])
        : (callIncoming?.get(path) ?? []),
    );
  }

  /**
   * @description Returns files whose exported functions call into the given file (one hop).
   * @param filePath - Project-relative path of the target file.
   * @returns Project-relative paths of all direct callers.
   */
  public getCallers(filePath: string): string[] {
    const callers: string[] = [];
    this.traverseCalls(
      filePath,
      (node) => {
        if (node.path !== filePath) callers.push(node.path);
        return true;
      },
      { direction: "incoming", maxDepth: 1 },
    );
    return callers;
  }

  /**
   * @description Returns all call edges originating from a file.
   * @param filePath - Project-relative path of the source file.
   * @returns The file's call edges, or an empty array if none exist.
   */
  public getCallEdgesFor(filePath: string): CallEdge[] {
    return this.nodes.get(filePath)?.callEdges ?? [];
  }

  /**
   * @description Returns the FileNodes that a given file directly imports —
   *   the first-hop outgoing neighbours in the import graph.
   * @param path - Project-relative path of the node to look up.
   * @returns Array of FileNodes imported by the given file; empty if the path is unknown.
   */
  public getNeighbors(path: string): FileNode[] {
    const node = this.nodes.get(path);
    if (!node) return [];
    return node.imports
      .map((imp) => this.nodes.get(imp.toPath))
      .filter((node): node is FileNode => node !== undefined);
  }

  /**
   * @description Identifies files that are not reachable from any entry point
   *   by walking the full import graph forward from each node.
   * @param allFiles - Complete list of project-relative file paths to test.
   * @returns Subset of `allFiles` that nothing imports, directly or transitively.
   */
  public findUnusedFiles(allFiles: string[]): string[] {
    return new GraphAnalyzer(this.nodes).findUnusedFiles(allFiles);
  }

  /**
   * @description Detects all circular import chains in the graph using DFS
   *   with a back-edge check. Each returned array is one cycle as an ordered path.
   * @returns Array of cycles; each cycle is a list of file paths forming a loop.
   */
  public findCycles(): string[][] {
    return new GraphAnalyzer(this.nodes).findCycles();
  }
}
