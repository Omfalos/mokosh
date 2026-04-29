import type { FileNode } from "../types";

/**
 * Utility for analyzing the dependency graph for cycles and unused files.
 */
export class GraphAnalyzer {
  constructor(private nodes: Map<string, FileNode>) {}

  /**
   * Finds files that are not present in the dependency graph.
   * @param allFiles List of all files in the project.
   * @returns List of files that are not reachable from entry points.
   */
  public findUnusedFiles(allFiles: string[]): string[] {
    const usedFiles = new Set(this.nodes.keys());
    return allFiles.filter((file) => !usedFiles.has(file));
  }

  /**
   * Recursively finds all cycles in the graph using DFS and a recursion stack.
   * @returns An array of cycles, where each cycle is an array of node paths.
   */
  public findCycles(): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const currentPath: string[] = [];

    const find = (current: string) => {
      visited.add(current);
      recStack.add(current);
      currentPath.push(current);

      const node = this.nodes.get(current);
      if (node) {
        for (const imp of node.imports) {
          if (!imp.toPath || imp.isExternal) continue;

          if (recStack.has(imp.toPath)) {
            // Found a cycle
            const cycleIndex = currentPath.indexOf(imp.toPath);
            cycles.push([...currentPath.slice(cycleIndex), imp.toPath]);
          } else if (!visited.has(imp.toPath)) {
            find(imp.toPath);
          }
        }
      }

      recStack.delete(current);
      currentPath.pop();
    };

    for (const nodePath of this.nodes.keys()) {
      if (!visited.has(nodePath)) {
        find(nodePath);
      }
    }

    return cycles;
  }
}
