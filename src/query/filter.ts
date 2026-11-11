/** Filters a graph by applying NodeQuery predicates: category, type, tag, path, imports, coverage, and more. */
import type { SerializedGraph } from "../types/graph";
import { matchNode } from "./matchers";
import type { NodeQuery } from "./types";

export { matchNode } from "./matchers";

/** @description Optional extras for {@link filterGraph}. */
export interface FilterGraphOptions {
  /** Path → owning-package-name lookup, from a flattened `WorkspaceGraph`. When supplied,
   *  enables the `package:` query key and stamps each result node with its `package`. */
  packageOf?: Map<string, string> | undefined;
}

type SortableNode = SerializedGraph["nodes"][number];

/** Numeric sort key per `NodeQuery.sort` field; a new sortable field is a new entry here. */
const SORT_METRICS: Record<NonNullable<NodeQuery["sort"]>, (node: SortableNode) => number> = {
  size: (node) => node.size,
  imports: (node) => node.imports.length,
  commitCount90d: (node) => node.commitCount90d ?? 0,
  exportUsage: (node) => node.avgExportUsage ?? 0,
  complexity: (node) => node.complexity ?? 0,
  cognitiveComplexity: (node) => node.cognitiveComplexity ?? 0,
};

/**
 * @description Filters a serialized graph to only nodes matching all criteria in `query`,
 *   then trims each node's import list to edges whose target is also in the result set.
 *   Optionally sorts the result and applies a `limit`.
 * @param {SerializedGraph} graph - The serialized graph to filter.
 * @param {NodeQuery} query - Filter criteria; omitted fields are treated as wildcards.
 * @param {FilterGraphOptions} [options] - Optional `packageOf` lookup for workspace-scoped queries.
 * @returns {SerializedGraph} A new `SerializedGraph` containing only the matching subgraph.
 */
export function filterGraph(
  graph: SerializedGraph,
  query: NodeQuery,
  options: FilterGraphOptions = {},
): SerializedGraph {
  const { packageOf } = options;
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

  const filteredNodes = graph.nodes.filter((node) =>
    matchNode(node, query, reverseIndex, packageOf),
  );
  const nodePaths = new Set(filteredNodes.map((node) => node.path));

  const resultNodes = filteredNodes.map((node) => {
    const pkg = packageOf?.get(node.path);
    return {
      ...node,
      imports: node.imports.filter((imp) => !imp.toPath || nodePaths.has(imp.toPath)),
      ...(pkg !== undefined && { package: pkg }),
    };
  });

  if (query.sort) {
    const direction = query.sortDir === "asc" ? -1 : 1;
    const metric = SORT_METRICS[query.sort];
    resultNodes.sort((nodeA, nodeB) => (metric(nodeB) - metric(nodeA)) * direction);
  }
  if (query.limit !== undefined) resultNodes.splice(query.limit);

  return {
    nodes: resultNodes,
    cycles:
      graph.cycles?.filter((cycle) => cycle.every((path) => nodePaths.has(path))) ?? undefined,
  };
}
