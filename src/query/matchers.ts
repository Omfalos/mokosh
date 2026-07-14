/** Per-field predicates used by matchNode() to test a FileNode against a single NodeQuery criterion. */
import type { FileNode } from "../types/node";
import type { NodeQuery } from "./types";

/**
 * @description Exact-match comparison with an optional `!` prefix for negation.
 * @param {string} nodeValue - The node's field value.
 * @param {string} queryValue - The query's criterion value, optionally prefixed with `!`.
 * @returns {boolean} `true` if `nodeValue` satisfies `queryValue`.
 */
function matchesStr(nodeValue: string, queryValue: string): boolean {
  if (queryValue.startsWith("!")) return nodeValue !== queryValue.slice(1);
  return nodeValue === queryValue;
}

/**
 * @description Substring comparison with an optional `!` prefix for negation.
 * @param {string} nodePath - The node's path.
 * @param {string} queryPath - The query's path substring, optionally prefixed with `!`.
 * @returns {boolean} `true` if `nodePath` satisfies `queryPath`.
 */
function matchesPath(nodePath: string, queryPath: string): boolean {
  if (queryPath.startsWith("!")) return !nodePath.includes(queryPath.slice(1));
  return nodePath.includes(queryPath);
}

/**
 * @description A single filter criterion evaluated against a node. Returns `true` when the
 *   node passes this criterion (including when the corresponding `query` field is unset, i.e.
 *   a wildcard). Each matcher owns exactly one `NodeQuery` field, so adding a new filter key
 *   means adding a new matcher to `NODE_MATCHERS` rather than editing `matchNode` itself.
 * @param {FileNode} node - The graph node to evaluate.
 * @param {NodeQuery} query - Filter criteria; omitted fields are treated as wildcards.
 * @param {Map<string, string[]>} reverseIndex - Optional reverse importer lookup, used by the `importedBy` matcher.
 * @returns {boolean} `true` if the node satisfies this single criterion.
 */
export type NodeMatcher = (
  node: FileNode,
  query: NodeQuery,
  reverseIndex: Map<string, string[]> | undefined,
) => boolean;

/** @description Matches `NodeQuery.category` against `FileNode.category`. */
export const matchCategory: NodeMatcher = (node, query) =>
  !query.category || matchesStr(node.category, query.category);

/** @description Matches `NodeQuery.type` against `FileNode.type`. */
export const matchType: NodeMatcher = (node, query) =>
  !query.type || matchesStr(node.type, query.type);

/**
 * @description Matches `NodeQuery.lastAuthor` against `FileNode.lastAuthor`. Nodes with no
 *   author data fail the positive form and pass the negative (`!`-prefixed) form.
 */
export const matchLastAuthor: NodeMatcher = (node, query) => {
  if (!query.lastAuthor) return true;
  if (query.lastAuthor.startsWith("!")) return node.lastAuthor !== query.lastAuthor.slice(1);
  return node.lastAuthor !== undefined && node.lastAuthor === query.lastAuthor;
};

/** @description Matches `NodeQuery.path` as a substring of `FileNode.path`. */
export const matchPath: NodeMatcher = (node, query) =>
  !query.path || matchesPath(node.path, query.path);

/** @description Matches `NodeQuery.isExternal` against whether the node has any external import. */
export const matchIsExternal: NodeMatcher = (node, query) => {
  if (query.isExternal === undefined) return true;
  const hasExternalImport = node.imports.some((importEdge) => importEdge.isExternal);
  return hasExternalImport === query.isExternal;
};

/**
 * @description Matches `NodeQuery.tags` using OR logic across positive entries; entries
 *   prefixed with `!` act as mandatory exclusions evaluated independently of the positive set.
 */
export const matchTags: NodeMatcher = (node, query) => {
  if (!query.tags || query.tags.length === 0) return true;
  const positiveTags = query.tags.filter((tag) => !tag.startsWith("!"));
  const negativeTags = query.tags.filter((tag) => tag.startsWith("!")).map((tag) => tag.slice(1));
  if (
    positiveTags.length > 0 &&
    !positiveTags.some((tag) => node.tags.some((structuredTag) => structuredTag.name === tag))
  )
    return false;
  if (negativeTags.some((tag) => node.tags.some((structuredTag) => structuredTag.name === tag)))
    return false;
  return true;
};

/** @description Matches `NodeQuery.allTags` using AND logic — every entry must be present. */
export const matchAllTags: NodeMatcher = (node, query) =>
  !query.allTags?.length ||
  query.allTags.every((tag) => node.tags.some((structuredTag) => structuredTag.name === tag));

/** @description Matches `NodeQuery.importsFile` as a substring of any import's `toPath`. */
export const matchImportsFile: NodeMatcher = (node, query) =>
  !query.importsFile ||
  node.imports.some((importEdge) => importEdge.toPath?.includes(query.importsFile as string));

/** @description Matches `NodeQuery.importedBy` as a substring of any importer path in `reverseIndex`. */
export const matchImportedBy: NodeMatcher = (node, query, reverseIndex) => {
  if (query.importedBy === undefined) return true;
  const importerPaths = reverseIndex?.get(node.path) ?? [];
  return importerPaths.some((importerPath) => importerPath.includes(query.importedBy as string));
};

/** @description Matches `NodeQuery.minImports` — node's import count must be at least this value. */
export const matchMinImports: NodeMatcher = (node, query) =>
  query.minImports === undefined || node.imports.length >= query.minImports;

/** @description Matches `NodeQuery.maxImports` — node's import count must be at most this value. */
export const matchMaxImports: NodeMatcher = (node, query) =>
  query.maxImports === undefined || node.imports.length <= query.maxImports;

/** @description Matches `NodeQuery.minSize` — node's file size must be at least this value. */
export const matchMinSize: NodeMatcher = (node, query) =>
  query.minSize === undefined || node.size >= query.minSize;

/** @description Matches `NodeQuery.maxSize` — node's file size must be at most this value. */
export const matchMaxSize: NodeMatcher = (node, query) =>
  query.maxSize === undefined || node.size <= query.maxSize;

/** @description Matches `NodeQuery.hasDocstring` against whether `FileNode.description` is set. */
export const matchHasDocstring: NodeMatcher = (node, query) =>
  query.hasDocstring === undefined || !!node.description === query.hasDocstring;

/** @description Matches `NodeQuery.isDocumented` against whether `FileNode.documentedBy` is non-empty. */
export const matchIsDocumented: NodeMatcher = (node, query) =>
  query.isDocumented === undefined || !!node.documentedBy?.length === query.isDocumented;

/** @description Matches `NodeQuery.isStale` against whether `FileNode.staleFor` is non-empty. */
export const matchIsStale: NodeMatcher = (node, query) =>
  query.isStale === undefined || !!node.staleFor?.length === query.isStale;

/**
 * @description Matches `NodeQuery.minCoverage`. Nodes with no coverage data are excluded
 *   (treated as 101%, i.e. always above any real threshold) — matching the
 *   "uncovered by default" convention.
 */
export const matchMinCoverage: NodeMatcher = (node, query) =>
  query.minCoverage === undefined || (node.coveragePct ?? 101) >= query.minCoverage;

/**
 * @description Matches `NodeQuery.maxCoverage`. Nodes with no coverage data are included
 *   (treated as 0%) — matching the "uncovered by default" convention.
 */
export const matchMaxCoverage: NodeMatcher = (node, query) =>
  query.maxCoverage === undefined || (node.coveragePct ?? 0) <= query.maxCoverage;

/** @description Matches `NodeQuery.minExportUsage`. Nodes with no coupling data are excluded. */
export const matchMinExportUsage: NodeMatcher = (node, query) =>
  query.minExportUsage === undefined || (node.avgExportUsage ?? -1) >= query.minExportUsage;

/** @description Matches `NodeQuery.maxExportUsage`. Nodes with no coupling data are included (treated as 0). */
export const matchMaxExportUsage: NodeMatcher = (node, query) =>
  query.maxExportUsage === undefined || (node.avgExportUsage ?? 0) <= query.maxExportUsage;

/**
 * @description Matches `NodeQuery.minComplexity`. Nodes with no complexity data are excluded —
 *   unlike `matchMinCoverage`'s large-sentinel convention (which inadvertently makes undata'd
 *   nodes pass any threshold), this uses `-Infinity` so missing data always fails a `>=` check.
 */
export const matchMinComplexity: NodeMatcher = (node, query) =>
  query.minComplexity === undefined || (node.complexity ?? -Infinity) >= query.minComplexity;

/** @description Matches `NodeQuery.maxComplexity`. Nodes with no complexity data are included (treated as 0). */
export const matchMaxComplexity: NodeMatcher = (node, query) =>
  query.maxComplexity === undefined || (node.complexity ?? 0) <= query.maxComplexity;

/** @description Matches `NodeQuery.minCognitiveComplexity`. Nodes with no complexity data are excluded. */
export const matchMinCognitiveComplexity: NodeMatcher = (node, query) =>
  query.minCognitiveComplexity === undefined ||
  (node.cognitiveComplexity ?? -Infinity) >= query.minCognitiveComplexity;

/** @description Matches `NodeQuery.maxCognitiveComplexity`. Nodes with no complexity data are included (treated as 0). */
export const matchMaxCognitiveComplexity: NodeMatcher = (node, query) =>
  query.maxCognitiveComplexity === undefined ||
  (node.cognitiveComplexity ?? 0) <= query.maxCognitiveComplexity;

/** @description Matches `NodeQuery.minCommits`. Nodes with no git-stats data are excluded. */
export const matchMinCommits: NodeMatcher = (node, query) =>
  query.minCommits === undefined || (node.commitCount90d ?? -Infinity) >= query.minCommits;

/** @description Matches `NodeQuery.maxCommits`. Nodes with no git-stats data are included (treated as 0). */
export const matchMaxCommits: NodeMatcher = (node, query) =>
  query.maxCommits === undefined || (node.commitCount90d ?? 0) <= query.maxCommits;

/**
 * @description Matches `NodeQuery.any` — the node passes if it satisfies at least one sub-query
 *   in the OR-group, ANDed with every other top-level criterion via the rest of `NODE_MATCHERS`.
 */
export const matchAny: NodeMatcher = (node, query, reverseIndex) =>
  !query.any?.length || query.any.some((subQuery) => matchNode(node, subQuery, reverseIndex));

/** @description All matchers, applied in order by `matchNode`. Add new filter keys here. */
export const NODE_MATCHERS: NodeMatcher[] = [
  matchCategory,
  matchType,
  matchLastAuthor,
  matchPath,
  matchIsExternal,
  matchTags,
  matchAllTags,
  matchImportsFile,
  matchImportedBy,
  matchMinImports,
  matchMaxImports,
  matchMinSize,
  matchMaxSize,
  matchHasDocstring,
  matchIsDocumented,
  matchIsStale,
  matchMinCoverage,
  matchMaxCoverage,
  matchMinExportUsage,
  matchMaxExportUsage,
  matchMinComplexity,
  matchMaxComplexity,
  matchMinCognitiveComplexity,
  matchMaxCognitiveComplexity,
  matchMinCommits,
  matchMaxCommits,
  matchAny,
];

/**
 * @description Tests whether a graph node satisfies all criteria in `query` by running it
 *   through every matcher in `NODE_MATCHERS`. String fields use exact match with an optional
 *   `!` prefix for negation. `tags` uses OR logic across positive entries; negated tags act
 *   as mandatory exclusions. Adding a new query key requires adding a new matcher to
 *   `NODE_MATCHERS`, not editing this function. Lives here (not in `filter.ts`) so `matchAny`
 *   can recurse into `NodeQuery.any` sub-queries without a circular import between the two modules.
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
