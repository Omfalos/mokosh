/** Filters a graph by applying NodeQuery predicates: category, type, tag, path, imports, coverage, and more. */
import type { SerializedGraph } from "../types/graph";
import { matchNode } from "./matchers";
import type { NodeQuery } from "./types";

export { matchNode } from "./matchers";

/**
 * @description Filters a serialized graph to only nodes matching all criteria in `query`,
 *   then trims each node's import list to edges whose target is also in the result set.
 *   Optionally sorts the result and applies a `limit`.
 * @param {SerializedGraph} graph - The serialized graph to filter.
 * @param {NodeQuery} query - Filter criteria; omitted fields are treated as wildcards.
 * @returns {SerializedGraph} A new `SerializedGraph` containing only the matching subgraph.
 */
export function filterGraph(graph: SerializedGraph, query: NodeQuery): SerializedGraph {
  const reverseIndex = new Map<string, string[]>();
  if (query.importedBy !== undefined) {
    for (const node of graph.nodes) {
      for (const imp of node.imports) {
        if (imp.toPath) {
          const arr = reverseIndex.get(imp.toPath) ?? [];
          arr.push(node.path);
          reverseIndex.set(imp.toPath, arr);
        }
      }
    }
  }

  const filteredNodes = graph.nodes.filter((node) => matchNode(node, query, reverseIndex));
  const nodePaths = new Set(filteredNodes.map((node) => node.path));

  const resultNodes = filteredNodes.map((node) => ({
    ...node,
    imports: node.imports.filter((imp) => !imp.toPath || nodePaths.has(imp.toPath)),
  }));

  if (query.sort) {
    const direction = query.sortDir === "asc" ? -1 : 1;
    resultNodes.sort((nodeA, nodeB) => {
      let diff = 0;
      if (query.sort === "size") diff = nodeB.size - nodeA.size;
      else if (query.sort === "imports") diff = nodeB.imports.length - nodeA.imports.length;
      else if (query.sort === "commitCount90d")
        diff = (nodeB.commitCount90d ?? 0) - (nodeA.commitCount90d ?? 0);
      else if (query.sort === "exportUsage")
        diff = (nodeB.avgExportUsage ?? 0) - (nodeA.avgExportUsage ?? 0);
      else if (query.sort === "complexity")
        diff = (nodeB.complexity ?? 0) - (nodeA.complexity ?? 0);
      else if (query.sort === "cognitiveComplexity")
        diff = (nodeB.cognitiveComplexity ?? 0) - (nodeA.cognitiveComplexity ?? 0);
      return diff * direction;
    });
  }
  if (query.limit !== undefined) resultNodes.splice(query.limit);

  return {
    nodes: resultNodes,
    cycles:
      graph.cycles?.filter((cycle) => cycle.every((path) => nodePaths.has(path))) ?? undefined,
  };
}
