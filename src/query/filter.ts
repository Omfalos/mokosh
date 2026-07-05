/** Filters a graph by applying NodeQuery predicates: category, type, tag, path, imports, coverage, and more. */
import type { SerializedGraph } from "../types/graph";
import type { FileNode } from "../types/node";
import { NODE_MATCHERS } from "./matchers";
import type { NodeQuery } from "./types";

/**
 * @description Tests whether a graph node satisfies all criteria in `query` by running it
 *   through every matcher in `NODE_MATCHERS`. String fields use exact match with an optional
 *   `!` prefix for negation. `tags` uses OR logic across positive entries; negated tags act
 *   as mandatory exclusions. Adding a new query key requires adding a new matcher to
 *   `NODE_MATCHERS`, not editing this function.
 * @param {FileNode} node - The graph node to evaluate.
 * @param {NodeQuery} query - Filter criteria; omitted fields are treated as wildcards.
 * @param {Map<string, string[]>} reverseIndex - Optional reverse importer lookup, required when `query.importedBy` is set.
 * @returns {boolean} `true` if the node passes every active filter criterion.
 */
export function matchNode(
  node: FileNode,
  query: NodeQuery,
  reverseIndex?: Map<string, string[]>,
): boolean {
  return NODE_MATCHERS.every((matcher) => matcher(node, query, reverseIndex));
}

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
    resultNodes.sort((nodeA, nodeB) => {
      if (query.sort === "size") return nodeB.size - nodeA.size;
      if (query.sort === "imports") return nodeB.imports.length - nodeA.imports.length;
      if (query.sort === "commitCount90d")
        return (nodeB.commitCount90d ?? 0) - (nodeA.commitCount90d ?? 0);
      if (query.sort === "exportUsage")
        return (nodeB.avgExportUsage ?? 0) - (nodeA.avgExportUsage ?? 0);
      return 0;
    });
  }
  if (query.limit !== undefined) resultNodes.splice(query.limit);

  return {
    nodes: resultNodes,
    cycles:
      graph.cycles?.filter((cycle) => cycle.every((path) => nodePaths.has(path))) ?? undefined,
  };
}
