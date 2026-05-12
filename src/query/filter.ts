import type { FileNode, SerializedGraph } from "../types";
import type { NodeQuery } from "./types";

function matchesStr(nodeValue: string, queryValue: string): boolean {
  if (queryValue.startsWith("!")) return nodeValue !== queryValue.slice(1);
  return nodeValue === queryValue;
}

function matchesPath(nodePath: string, queryPath: string): boolean {
  if (queryPath.startsWith("!")) return !nodePath.includes(queryPath.slice(1));
  return nodePath.includes(queryPath);
}

export function matchNode(node: FileNode, query: NodeQuery): boolean {
  if (query.category && !matchesStr(node.category, query.category)) return false;
  if (query.type && !matchesStr(node.type, query.type)) return false;
  if (query.path && !matchesPath(node.path, query.path)) return false;
  if (query.isExternal !== undefined) {
    const hasExternal = node.imports.some((imp) => imp.isExternal);
    if (hasExternal !== query.isExternal) return false;
  }

  if (query.tags && query.tags.length > 0) {
    const positive = query.tags.filter((t) => !t.startsWith("!"));
    const negative = query.tags.filter((t) => t.startsWith("!")).map((t) => t.slice(1));
    if (positive.length > 0 && !positive.some((t) => node.tags.some((st) => st.name === t)))
      return false;
    if (negative.some((t) => node.tags.some((st) => st.name === t))) return false;
  }

  return true;
}

/**
 * Filters a serialized graph to only the nodes that match all criteria in
 * `query`, and trims each node's import list to edges whose target is also
 * present in the result set.
 *
 * @param graph - The serialized graph to filter.
 * @param query - Filter criteria; omitted fields are treated as wildcards.
 * @returns A new {@link SerializedGraph} containing only the matching subgraph.
 */
export function filterGraph(graph: SerializedGraph, query: NodeQuery): SerializedGraph {
  const filteredNodes = graph.nodes.filter((node) => matchNode(node, query));
  const nodePaths = new Set(filteredNodes.map((n) => n.path));

  const resultNodes = filteredNodes.map((node) => ({
    ...node,
    imports: node.imports.filter((imp) => !imp.toPath || nodePaths.has(imp.toPath)),
  }));

  return {
    nodes: resultNodes,
    cycles:
      graph.cycles?.filter((cycle) => cycle.every((path) => nodePaths.has(path))) ?? undefined,
  };
}
