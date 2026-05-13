import path from "node:path";
import {
  applyConfig,
  detectFeatures,
  filterGraph,
  Graph,
  getAllProjectFiles,
  getGitDiffFiles,
  loadMokoshConfig,
  MermaidExporter,
  parseQuery,
  proposeAffectedTests,
  proposeTags,
} from "../index";
import type { SessionState } from "./cache";
import type { TextResponse } from "./utils";
import { text } from "./utils";

// ---------------------------------------------------------------------------
// Argument types — one per tool, matching the schemas defined in tools.ts
// ---------------------------------------------------------------------------

export type AnalyzeArgs = { root: string; entryPoints: string[] };
export type GetDependenciesArgs = { root: string; file: string; depth?: number };
export type GetDependentsArgs = { root: string; file: string };
export type GetAffectedArgs = { root: string; file: string; testsOnly?: boolean };
export type FindUnusedArgs = { root: string; entryPoints: string[] };
export type ProposeTagsArgs = { root: string; changedFiles?: string[]; featureThreshold?: number };
export type ProposeAffectedTestsArgs = {
  root: string;
  changedFiles?: string[];
  featureThreshold?: number;
};
export type DetectFeaturesArgs = {
  root: string;
  entryPoints?: string[];
  featureThreshold?: number;
};
export type QueryArgs = { root: string; entryPoints?: string[]; filter: string; mermaid?: boolean };

export type ToolArgs =
  | AnalyzeArgs
  | GetDependenciesArgs
  | GetDependentsArgs
  | GetAffectedArgs
  | FindUnusedArgs
  | ProposeTagsArgs
  | ProposeAffectedTestsArgs
  | DetectFeaturesArgs
  | QueryArgs;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Builds (or incrementally refreshes) the dependency graph and caches it for
 * the session. Returns a lightweight summary — callers that need the full graph
 * should call `get_dependencies` or `query` afterwards.
 */
export async function handleAnalyze(cache: SessionState, args: AnalyzeArgs) {
  const { root, entryPoints } = args;
  if (!cache.isConfigured(root)) {
    const config = loadMokoshConfig(root, { allowJs: false });
    applyConfig(config);
    cache.storeConfig(root, config);
  }
  const resolvedEntries = entryPoints.map((ep) => path.resolve(root, ep));
  const graph = await cache.getOrBuild(root, resolvedEntries);
  const serialized = graph.serialize();
  const categories = serialized.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.category] = (acc[n.category] ?? 0) + 1;
    return acc;
  }, {});
  const cycles = graph.findCycles();
  return text({ nodeCount: serialized.nodes.length, categories, cycles });
}

/**
 * Outgoing traversal from `file` — returns all files that `file` imports,
 * up to `depth` hops (default 1 = immediate imports only).
 *
 * Requires a prior `analyze` call for the same `root`.
 */
export function handleGetDependencies(cache: SessionState, args: GetDependenciesArgs) {
  const { root, file, depth = 1 } = args;
  const graph = cache.require(root);
  const deps: string[] = [];
  graph.traverse(
    file,
    (node) => {
      if (node.path !== file) deps.push(node.path);
      return true;
    },
    { direction: "outgoing", maxDepth: depth },
  );
  return text({ file, dependencies: deps });
}

/**
 * Incoming one-hop traversal — returns files that directly import `file`.
 * For the full transitive upstream set use `get_affected` instead.
 *
 * Requires a prior `analyze` call for the same `root`.
 */
export function handleGetDependents(cache: SessionState, args: GetDependentsArgs) {
  const { root, file } = args;
  const graph = cache.require(root);
  const dependents: string[] = [];
  graph.traverse(
    file,
    (node) => {
      if (node.path !== file) dependents.push(node.path);
      return true;
    },
    { direction: "incoming", maxDepth: 1 },
  );
  return text({ file, dependents });
}

/**
 * Full incoming traversal from `file` upward through the graph — returns every
 * file whose behaviour could change if `file` changes (blast-radius analysis).
 * Pass `testsOnly: true` to restrict results to test/spec files only.
 *
 * Requires a prior `analyze` call for the same `root`.
 */
export function handleGetAffected(cache: SessionState, args: GetAffectedArgs) {
  const { root, file, testsOnly = false } = args;
  const graph = cache.require(root);
  const affected: string[] = [];
  graph.traverse(
    file,
    (node) => {
      if (node.path === file) return true;
      const isTest = node.category === "test" || node.tags.some((t) => t.name === "test");
      if (!testsOnly || isTest) affected.push(node.path);
      return true;
    },
    { direction: "incoming" },
  );
  return text({ file, affected, count: affected.length });
}

/**
 * Scans the entire project directory and compares against the graph reachable
 * from `entryPoints`. Returns files that exist on disk but are not imported by
 * any entry point — candidates for deletion or dead-code review.
 */
export async function handleFindUnused(cache: SessionState, args: FindUnusedArgs) {
  const { root, entryPoints } = args;
  const resolvedEntries = entryPoints.map((ep) => path.resolve(root, ep));
  const graph = await cache.getOrBuild(root, resolvedEntries);
  const allFiles = getAllProjectFiles(root);
  const unusedFiles = graph.findUnusedFiles(allFiles);
  return text({ unusedFiles, count: unusedFiles.length });
}

/**
 * Performs a backward traversal from each changed file to find all test files
 * that transitively depend on it, then collects their tags. Feature hub files
 * (high in-degree) short-circuit traversal and emit a `feature:<name>` tag
 * instead, preventing tag explosion for widely-imported utilities.
 *
 * Pass `changedFiles` explicitly (relative to `root`) or omit to read from
 * `git diff --name-only`. Requires a prior `analyze` call for the same `root`.
 */
export function handleProposeTags(cache: SessionState, args: ProposeTagsArgs) {
  const { root, changedFiles, featureThreshold } = args;
  const graph = cache.require(root);
  const files =
    changedFiles ?? getGitDiffFiles().map((f) => path.relative(root, path.resolve(root, f)));
  const tags = proposeTags(graph, files, {
    ...(featureThreshold !== undefined && { featureDetection: { minOutDegree: featureThreshold } }),
  });
  return text({ changedFiles: files, proposedTags: tags });
}

/**
 * Returns the file paths of test files transitively affected by the changed files.
 *
 * Uses the same symbol-aware graph traversal as `propose_tags` but collects
 * file paths instead of tag strings — making it suitable for piping directly
 * into a test runner: `vitest $(mokosh --affected-tests)`.
 *
 * Feature hubs act as traversal boundaries: tests beyond a hub are excluded
 * because running the hub's tests already covers that dependency chain.
 *
 * Pass `changedFiles` explicitly or omit to read from `git diff --name-only`.
 * Requires a prior `analyze` call for the same `root`.
 */
export function handleProposeAffectedTests(cache: SessionState, args: ProposeAffectedTestsArgs) {
  const { root, changedFiles, featureThreshold } = args;
  const graph = cache.require(root);
  const files =
    changedFiles ?? getGitDiffFiles().map((f) => path.relative(root, path.resolve(root, f)));
  const affectedTests = proposeAffectedTests(graph, files, {
    ...(featureThreshold !== undefined && { featureDetection: { minOutDegree: featureThreshold } }),
  });
  return text({ changedFiles: files, affectedTests, count: affectedTests.length });
}

/**
 * Identifies feature files — source files that import many other internal modules
 * (out-degree). Returns them sorted by out-degree descending so the most complex
 * aggregators appear first. Use `featureThreshold` to tune sensitivity.
 *
 * Builds a fresh graph from `entryPoints` when provided; otherwise reuses the
 * cached graph from a prior `analyze` call.
 */
export async function handleDetectFeatures(cache: SessionState, args: DetectFeaturesArgs) {
  const { root, entryPoints, featureThreshold } = args;
  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : cache.require(root);
  const featureMap = detectFeatures(
    graph.nodes,
    featureThreshold !== undefined ? { minOutDegree: featureThreshold } : undefined,
  );
  const features = Array.from(featureMap.values()).sort((a, b) => b.outDegree - a.outDegree);
  return text({ features, count: features.length });
}

/**
 * Filters the graph by category, tag, or path substring and returns matching
 * nodes as JSON. Pass `mermaid: true` to receive a `graph TD` Mermaid diagram
 * string instead — useful for visual documentation or quick orientation.
 */
export async function handleQuery(cache: SessionState, args: QueryArgs): Promise<TextResponse> {
  const { root, entryPoints, filter, mermaid = false } = args;
  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : cache.require(root);
  const filtered = filterGraph(graph.serialize(), parseQuery(filter));
  if (mermaid) {
    return text(MermaidExporter.toMermaid(Graph.deserialize(filtered)));
  }
  return text(filtered);
}
