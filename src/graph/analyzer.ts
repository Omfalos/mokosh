/** Analyzes a dependency graph node map for unused files, export-usage hotspots, and circular import chains. */
import type { FileNode } from "../types/node";

/**
 * @description Utility for analyzing the dependency graph for cycles and unused files.
 *   Operates on the raw node map rather than a `Graph` instance so it can be used
 *   without the full traversal infrastructure.
 */
export class GraphAnalyzer {
  /**
   * @param {Map<string, FileNode>} nodes - The full node map of the graph to analyze, keyed by project-relative file path.
   */
  constructor(private nodes: Map<string, FileNode>) {}

  /**
   * @description Returns files from `allFiles` that are absent from the graph — meaning nothing
   *   imports them directly or transitively from any entry point, making them deletion candidates.
   * @param {string[]} allFiles - Complete list of project-relative file paths to test against the graph.
   * @returns {string[]} Subset of `allFiles` whose paths do not appear as graph nodes.
   */
  public findUnusedFiles(allFiles: string[]): string[] {
    const usedFiles = new Set(this.nodes.keys());
    return allFiles.filter((file) => !usedFiles.has(file));
  }

  /**
   * @description Returns files whose highest single-edge export usage ratio meets or exceeds
   *   `threshold`, sorted descending by `maxExportUsage`. Useful for identifying files
   *   that consume a large fraction of one dependency's API surface.
   * @param {number} threshold - Minimum `maxExportUsage` value (0–1) for a file to be included.
   * @returns {Array<{ path: string; maxExportUsage: number; tightestDep: string }>} Entries sorted descending by `maxExportUsage`.
   */
  public findHighExportUsage(
    threshold: number,
  ): Array<{ path: string; maxExportUsage: number; tightestDep: string }> {
    const results: Array<{ path: string; maxExportUsage: number; tightestDep: string }> = [];

    for (const node of this.nodes.values()) {
      if (node.maxExportUsage === undefined || node.maxExportUsage < threshold) continue;
      const tightest = node.imports.reduce(
        (best, imp) => ((imp.exportUsageRatio ?? 0) > (best?.exportUsageRatio ?? 0) ? imp : best),
        null as (typeof node.imports)[number] | null,
      );
      results.push({
        path: node.path,
        maxExportUsage: node.maxExportUsage,
        tightestDep: tightest?.toPath ?? "",
      });
    }

    return results.sort((left, right) => right.maxExportUsage - left.maxExportUsage);
  }

  /**
   * @description Detects all circular import chains using DFS with a recursion-stack back-edge check.
   *   Each returned array is one cycle as an ordered list of file paths ending at the entry that closes the loop.
   * @returns {string[][]} Array of cycles; each cycle is an ordered list of file paths forming a loop.
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
