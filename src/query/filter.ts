/** Filters a graph by applying NodeQuery predicates: category, type, tag, path, imports, coverage, and more. */
import type { SerializedGraph } from "../types/graph";
import type { FileNode } from "../types/node";
import type { NodeQuery } from "./types";

function matchesStr(nodeValue: string, queryValue: string): boolean {
  if (queryValue.startsWith("!")) return nodeValue !== queryValue.slice(1);
  return nodeValue === queryValue;
}

function matchesPath(nodePath: string, queryPath: string): boolean {
  if (queryPath.startsWith("!")) return !nodePath.includes(queryPath.slice(1));
  return nodePath.includes(queryPath);
}

/**
 * @description Tests whether a graph node satisfies all criteria in `query`.
 *   String fields use exact match with an optional `!` prefix for negation.
 *   `tags` uses OR logic across positive entries; negated tags act as mandatory exclusions.
 *   Coverage fields treat nodes with no data as 101% for `minCoverage` and 0% for `maxCoverage`.
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

  if (query.allTags?.length) {
    if (!query.allTags.every((t) => node.tags.some((st) => st.name === t))) return false;
  }
  if (query.importsFile) {
    if (!node.imports.some((imp) => imp.toPath?.includes(query.importsFile as string)))
      return false;
  }
  if (query.importedBy !== undefined) {
    const importers = reverseIndex?.get(node.path) ?? [];
    if (!importers.some((p) => p.includes(query.importedBy as string))) return false;
  }
  if (query.minImports !== undefined && node.imports.length < query.minImports) return false;
  if (query.maxImports !== undefined && node.imports.length > query.maxImports) return false;
  if (query.minSize !== undefined && node.size < query.minSize) return false;
  if (query.maxSize !== undefined && node.size > query.maxSize) return false;
  if (query.hasDocstring !== undefined) {
    if (!!node.description !== query.hasDocstring) return false;
  }
  // Nodes with no coverage data are excluded from minCoverage (treated as 101%) and
  // included in maxCoverage (treated as 0%) — matching the "uncovered by default" convention.
  if (query.minCoverage !== undefined && (node.coveragePct ?? 101) < query.minCoverage)
    return false;
  if (query.maxCoverage !== undefined && (node.coveragePct ?? 0) > query.maxCoverage) return false;
  // Nodes with no coupling data are excluded from minExportUsage and included in maxExportUsage.
  if (query.minExportUsage !== undefined && (node.avgExportUsage ?? -1) < query.minExportUsage)
    return false;
  if (query.maxExportUsage !== undefined && (node.avgExportUsage ?? 0) > query.maxExportUsage)
    return false;

  return true;
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
    for (const n of graph.nodes) {
      for (const imp of n.imports) {
        if (imp.toPath) {
          const arr = reverseIndex.get(imp.toPath) ?? [];
          arr.push(n.path);
          reverseIndex.set(imp.toPath, arr);
        }
      }
    }
  }

  const filteredNodes = graph.nodes.filter((node) => matchNode(node, query, reverseIndex));
  const nodePaths = new Set(filteredNodes.map((n) => n.path));

  const resultNodes = filteredNodes.map((node) => ({
    ...node,
    imports: node.imports.filter((imp) => !imp.toPath || nodePaths.has(imp.toPath)),
  }));

  if (query.sort) {
    resultNodes.sort((a, b) => {
      if (query.sort === "size") return b.size - a.size;
      if (query.sort === "imports") return b.imports.length - a.imports.length;
      if (query.sort === "commitCount90d") return (b.commitCount90d ?? 0) - (a.commitCount90d ?? 0);
      if (query.sort === "exportUsage") return (b.avgExportUsage ?? 0) - (a.avgExportUsage ?? 0);
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
