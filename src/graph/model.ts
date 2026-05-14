import type { SerializedGraph, TraversalOptions, TraversalVisitor } from "../types/graph";
import type { FileNode } from "../types/node";
import { GraphAnalyzer } from "./analyzer";

/**
 * Represents the dependency graph of the project.
 */
export class Graph {
  private _incomingEdgesCache: Map<string, string[]> | null = null;

  constructor(public nodes: Map<string, FileNode>) {}

  /**
   * Serializes the graph into a plain object.
   */
  public serialize(): SerializedGraph {
    return {
      nodes: Array.from(this.nodes.values()),
    };
  }

  /**
   * Deserializes a graph from a plain object.
   */
  public static deserialize(serialized: SerializedGraph): Graph {
    const nodes = new Map<string, FileNode>();
    for (const node of serialized.nodes) {
      nodes.set(node.path, node);
    }
    return new Graph(nodes);
  }

  /**
   * Returns a map of incoming edges for each node.
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
   * Performs a Depth-First Search (DFS) on the dependency graph.
   * Supports both outgoing and incoming (reverse) traversal.
   *
   * @param startPath The node path to begin traversal from.
   * @param visitor Callback function executed for each node. Return false to stop traversing a branch.
   * @param options Configuration for maxDepth and direction.
   */
  public traverse(startPath: string, visitor: TraversalVisitor, options: TraversalOptions = {}) {
    const visited = new Set<string>();
    const maxDepth = options.maxDepth ?? Infinity;
    const direction = options.direction ?? "outgoing";

    // Reverse edges map is needed for "incoming" traversal
    const incoming = direction === "incoming" ? this.getIncomingEdgesMap() : null;

    const walk = (currentPath: string, depth: number, parentPath: string | null) => {
      // Termination conditions
      if (depth > maxDepth || visited.has(currentPath)) return;

      const node = this.nodes.get(currentPath);
      if (!node) return;

      visited.add(currentPath);

      // Execute visitor; allow stopping branch traversal
      const shouldContinue = visitor(node, depth, parentPath) !== false;
      if (!shouldContinue) return;

      if (direction === "outgoing") {
        this.walkOutgoing(node, depth, walk);
      } else if (incoming) {
        this.walkIncoming(currentPath, depth, incoming, walk);
      }
    };

    walk(startPath, 0, null);
  }

  private walkOutgoing(
    node: FileNode,
    depth: number,
    walk: (p: string, d: number, parent: string | null) => void,
  ) {
    for (const imp of node.imports) {
      if (imp.toPath) {
        walk(imp.toPath, depth + 1, node.path);
      }
    }
  }

  private walkIncoming(
    currentPath: string,
    depth: number,
    incoming: Map<string, string[]>,
    walk: (p: string, d: number, parent: string | null) => void,
  ) {
    const parents = incoming.get(currentPath) || [];
    for (const parent of parents) {
      walk(parent, depth + 1, currentPath);
    }
  }

  /**
   * Returns the immediate dependencies of a node.
   */
  public getNeighbors(path: string): FileNode[] {
    const node = this.nodes.get(path);
    if (!node) return [];
    return node.imports
      .map((imp) => this.nodes.get(imp.toPath))
      .filter((n): n is FileNode => n !== undefined);
  }

  /**
   * Finds files that are not reachable from entry points.
   * @param allFiles List of all project files.
   */
  public findUnusedFiles(allFiles: string[]): string[] {
    return new GraphAnalyzer(this.nodes).findUnusedFiles(allFiles);
  }

  /**
   * Finds all circular dependencies in the graph.
   */
  public findCycles(): string[][] {
    return new GraphAnalyzer(this.nodes).findCycles();
  }
}
