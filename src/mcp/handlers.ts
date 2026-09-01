import path from "node:path";
import { DefaultGitProvider } from "../git";
import {
  applyConfig,
  applyTags,
  buildApiSurface,
  buildFeatureGraph,
  buildResponsibilityGraph,
  buildTypeGraph,
  compareBranches,
  configToGraphOptions,
  DEFAULT_IGNORE_DIRS,
  detectAllEntryPoints,
  detectFeatures,
  detectMonorepo,
  filterGraph,
  findComplexFunctions,
  findDuplicates,
  findRiskHotspots,
  findSymbol,
  Graph,
  getAffected,
  getAllProjectFiles,
  getCallers,
  getDependencies,
  getDependents,
  getLanguageCoverage,
  getNodeMeta,
  hasCoverageData,
  loadCoverageMap,
  loadMokoshConfig,
  MermaidExporter,
  parseQuery,
  proposeAffectedTests,
  proposeTags,
  queryCallGraph,
  queryChangeImpact,
  queryTypeGraph,
  slimSerialize,
  summarizeBranchComparison,
  summarizeWorkspacePackages,
} from "../index";
import type { SessionState } from "./cache";
import type { TextResponse } from "./utils";
import { text } from "./utils";

// ---------------------------------------------------------------------------
// Argument types — one per tool, matching the schemas defined in tools.ts
// ---------------------------------------------------------------------------

export type AnalyzeArgs = { root: string; entryPoints: string[] };
export type GetWorkspacePackagesArgs = { root: string };
export type GetWorkspaceAffectedArgs = { root: string; file: string };
export type GetDependenciesArgs = {
  root: string;
  file: string;
  depth?: number;
  withMeta?: boolean;
};
export type GetDependentsArgs = { root: string; file: string; withMeta?: boolean };
export type GetAffectedArgs = {
  root: string;
  file: string;
  testsOnly?: boolean;
  cached?: boolean;
  changedSymbols?: string[];
  withMeta?: boolean;
};
export type CompareBranchesArgs = {
  root: string;
  baseRef: string;
  headRef?: string;
  entryPoints?: string[];
  minDuplicateLines?: number;
  complexityMetric?: "cognitiveComplexity" | "complexity";
  complexityThreshold?: number;
  maxCoveragePct?: number;
  detail?: "summary" | "full";
  maxItems?: number;
};
export type GetCallersArgs = {
  root: string;
  file: string;
  depth?: number;
  withEdgeDetail?: boolean;
};
export type FindSymbolArgs = { root: string; name: string };
export type FindUnusedArgs = { root: string; entryPoints?: string[] };
export type FindUncoveredArgs = { root: string; coverageThreshold?: number };
export type ListTagsArgs = { root: string };
export type CheckDocDriftArgs = { root: string };
export type FindComplexFunctionsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  threshold?: number;
  limit?: number;
};
export type FindRiskHotspotsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  minComplexity?: number;
  maxCoveragePct?: number;
  minChurn?: number;
  limit?: number;
};
export type FindDuplicatesArgs = {
  root: string;
  minLines?: number;
  ignoreLiterals?: boolean;
  maxPunctuationRatio?: number;
  limit?: number;
  ignoreDirs?: string[];
};
export type ProposeTagsArgs = {
  root: string;
  changedFiles?: string[];
  /** Diff against this ref (e.g. "origin/main") instead of only local working-tree/staged/
   *  untracked changes. Ignored when `changedFiles` is given. Needed in CI, where the checkout
   *  is already clean and there's nothing local left to diff. */
  base?: string;
  featureThreshold?: number;
  format?: "tags" | "paths";
};
export type DetectFeaturesArgs = {
  root: string;
  entryPoints?: string[];
  featureThreshold?: number;
};
export type QueryArgs = {
  root: string;
  entryPoints?: string[];
  filter: string;
  mermaid?: boolean;
  slim?: boolean;
};

export type ClearCacheArgs = { root: string };
export type GetTypeGraphArgs = { root: string; type?: string };
export type GetModuleResponsibilityArgs = { root: string; paths?: string[]; minOutDegree?: number };
export type GetFeatureGraphArgs = { root: string; minOutDegree?: number };
export type GetCallGraphArgs = { root: string; function: string };
export type GetApiSurfaceArgs = { root: string; entryPoints?: string[] };
export type ApplyTagsArgs = { root: string; dryRun?: boolean };

export type ToolArgs =
  | AnalyzeArgs
  | GetDependenciesArgs
  | GetDependentsArgs
  | GetAffectedArgs
  | CompareBranchesArgs
  | GetCallersArgs
  | FindSymbolArgs
  | FindUnusedArgs
  | FindUncoveredArgs
  | ListTagsArgs
  | CheckDocDriftArgs
  | FindComplexFunctionsArgs
  | FindRiskHotspotsArgs
  | FindDuplicatesArgs
  | ProposeTagsArgs
  | DetectFeaturesArgs
  | QueryArgs
  | ClearCacheArgs
  | GetTypeGraphArgs
  | GetModuleResponsibilityArgs
  | GetFeatureGraphArgs
  | GetCallGraphArgs
  | GetApiSurfaceArgs
  | ApplyTagsArgs;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * @description Builds (or incrementally refreshes) the dependency graph and caches it for
 *   the session. When `entryPoints` is empty, auto-detects whether `root` is a monorepo
 *   and builds a per-package workspace graph if so.
 * @param cache - Session state used to store and retrieve the built graph.
 * @param args - `root` is the project directory; `entryPoints` seeds the graph walk (empty triggers monorepo auto-detect).
 * @returns A lightweight summary of node count, categories, and cycles — call `get_dependencies` or `query` for full graph data.
 */
export async function handleAnalyze(cache: SessionState, args: AnalyzeArgs) {
  const { root, entryPoints } = args;
  if (!cache.isConfigured(root)) {
    const config = loadMokoshConfig(root, { allowJs: false });
    applyConfig(config);
    cache.storeConfig(root, config);
  }

  // Auto-detect monorepo when no entry points are provided
  if (entryPoints.length === 0) {
    const layout = detectMonorepo(root);
    if (layout.type !== "none") {
      const config = cache.getConfig(root);
      const workspaceGraph = await cache.getOrBuildWorkspace(root, configToGraphOptions(config));
      cache.storeLastAnalyze(root, { kind: "workspace" });
      cache.startWatching(root);
      const perPackage = Array.from(workspaceGraph.packages.values()).map(({ graph, pkg }) => ({
        package: pkg.name,
        relativeRoot: pkg.relativeRoot,
        nodeCount: graph.nodes.size,
      }));
      return text({
        monorepoType: layout.type,
        packageCount: workspaceGraph.packages.size,
        packages: perPackage,
      });
    }
  }

  const resolvedEntries = entryPoints.map((ep) => path.resolve(root, ep));
  const config = cache.getConfig(root);
  const coverageMap = config?.coverageReportPath
    ? loadCoverageMap(root, config.coverageReportPath)
    : new Map<string, number>();
  const graph = await cache.getOrBuild(root, resolvedEntries, coverageMap);
  cache.storeLastAnalyze(root, { kind: "single", entryPoints: resolvedEntries, coverageMap });
  cache.startWatching(root);
  const serialized = graph.serialize();
  const categories = serialized.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.category] = (acc[node.category] ?? 0) + 1;
    return acc;
  }, {});
  const cycles = graph.findCycles();
  const languageCoverage = getLanguageCoverage(graph);
  return text({ nodeCount: serialized.nodes.length, categories, cycles, languageCoverage });
}

/**
 * @description Outgoing traversal from `file` — returns all files that `file` imports,
 *   up to `depth` hops (default 1 = immediate imports only). Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the starting node; `depth` caps traversal depth; `withMeta` adds category/exports per result.
 * @returns TextResponse with `{ file, dependencies }` listing all reachable imported paths, each
 *   `{ path, symbols? }` or `{ path, symbols?, category, exports }` when `withMeta` is true.
 */
export async function handleGetDependencies(
  cache: SessionState,
  args: GetDependenciesArgs,
): Promise<TextResponse> {
  const { root, file, depth = 1, withMeta = false } = args;
  const graph = await cache.ensureFresh(root);
  const deps = getDependencies(graph, file, depth);
  const dependencies = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  return text({ file, dependencies });
}

/**
 * @description Incoming one-hop traversal — returns files that directly import `file`.
 *   For the full transitive upstream set use `handleGetAffected` instead. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the node whose direct importers to find; `withMeta` adds category/exports per result.
 * @returns TextResponse with `{ file, dependents }` listing files that import `file` directly, each
 *   `{ path, symbols? }` or `{ path, symbols?, category, exports }` when `withMeta` is true.
 */
export async function handleGetDependents(
  cache: SessionState,
  args: GetDependentsArgs,
): Promise<TextResponse> {
  const { root, file, withMeta = false } = args;
  const graph = await cache.ensureFresh(root);
  const deps = getDependents(graph, file);
  const dependents = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  return text({ file, dependents });
}

/**
 * @description Full incoming traversal from `file` upward — returns every file whose behaviour
 *   could change if `file` changes (blast-radius analysis). Set `cached=true` to use a pre-computed
 *   O(1) impact cache instead of graph traversal — faster on repeated calls for the same root.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the changed node; `testsOnly` restricts results to test/spec files; `cached` switches to the impact cache; `withMeta` turns each affected path into `{ path, category, exports }`.
 * @returns TextResponse with `{ file, affected, count }` listing all transitively impacted files
 *   (bare paths, or `{ path, category, exports }` objects when `withMeta` is true).
 */
export async function handleGetAffected(
  cache: SessionState,
  args: GetAffectedArgs,
): Promise<TextResponse> {
  const { root, file, testsOnly = false, cached = false, changedSymbols, withMeta = false } = args;
  const graph = await cache.ensureFresh(root);
  const annotate = (paths: string[]) =>
    withMeta ? paths.map((p) => ({ path: p, ...getNodeMeta(graph, p) })) : paths;

  if (cached) {
    const impactCache = cache.getOrBuildChangeImpact(root);
    const allAffected = queryChangeImpact(impactCache, file);
    const affected = testsOnly
      ? allAffected.filter((filePath) => graph.nodes.get(filePath)?.category === "test")
      : allAffected;
    const result = annotate(affected);
    return text({ file, affected: result, count: result.length });
  }
  const affected = getAffected(graph, file, { testsOnly, changedSymbols });
  const result = annotate(affected);
  return text({ file, affected: result, count: result.length });
}

/**
 * @description Compares the current graph (`root`, kept fresh the same way every other handler
 *   is via `ensureFresh`) against `baseRef` — file diff, exported symbols removed at head that
 *   an importer still references (a likely-missed rename/removal), and deltas across duplication,
 *   complexity, doc drift, and (when coverage is loaded) risk hotspots. The base ref's graph is
 *   built via a temporary `git worktree` and cached to disk by commit sha, so repeat comparisons
 *   against the same base commit are free after the first. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root`/`baseRef` identify the comparison; `entryPoints` seeds the base-ref build
 *   (defaults to the entry points from the last `analyze` call); `detail` (`"summary"`, default, or
 *   `"full"`) picks the token-frugal projection vs. the complete `BranchComparison`; `maxItems`
 *   caps each delta list in summary mode (default 8); the rest tune the underlying
 *   duplication/complexity/coverage tool calls.
 * @returns TextResponse with a `BranchComparisonSummary` (default) or the full `BranchComparison`.
 */
export async function handleCompareBranches(
  cache: SessionState,
  args: CompareBranchesArgs,
): Promise<TextResponse> {
  const { root, baseRef, headRef, minDuplicateLines, complexityMetric, complexityThreshold } = args;
  const graph = await cache.ensureFresh(root);
  const entryPoints =
    args.entryPoints ?? cache.getLastEntryPoints(root)?.map((ep) => path.relative(root, ep)) ?? [];
  const comparison = await compareBranches(root, baseRef, graph, {
    headRef,
    entryPoints,
    minDuplicateLines,
    complexityMetric,
    complexityThreshold,
    maxCoveragePct: args.maxCoveragePct,
    ...configToGraphOptions(cache.getConfig(root)),
  });
  if (args.detail === "full") return text(comparison);
  return text(
    summarizeBranchComparison(comparison, { metric: complexityMetric, maxItems: args.maxItems }),
  );
}

/**
 * @description Incoming call-edge traversal — returns files whose exported functions call
 *   into `file`. More precise than `handleGetAffected` because it follows runtime call edges
 *   rather than all import edges.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root`/`file` identify the target; `depth` caps hops; `withEdgeDetail` adds from/to function names per edge.
 * @returns TextResponse with `{ file, callers, count }` where each caller optionally includes edge detail.
 */
export async function handleGetCallers(
  cache: SessionState,
  args: GetCallersArgs,
): Promise<TextResponse> {
  const { root, file, depth = 1, withEdgeDetail = false } = args;
  const graph = await cache.ensureFresh(root);
  const callers = getCallers(graph, file, { depth, withEdgeDetail });
  return text({ file, callers, count: callers.length });
}

/**
 * @description Scans the entire project directory and compares against the graph reachable
 *   from `entryPoints`, returning files that exist on disk but are never imported — candidates for deletion.
 *   When `entryPoints` is omitted, reuses the cached graph from a prior `analyze` call instead of rebuilding.
 *   The disk scan excludes `DEFAULT_IGNORE_DIRS` merged with this root's configured `ignoreDirs`/`extensions`,
 *   if any, so custom-ignored directories aren't reported as containing unused files.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root` is the project directory; `entryPoints` seeds the reachability walk (omit to reuse the cache).
 * @returns TextResponse with `{ unusedFiles, count }` listing files unreachable from any entry point.
 */
export async function handleFindUnused(cache: SessionState, args: FindUnusedArgs) {
  const { root, entryPoints } = args;
  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : await cache.ensureFresh(root);
  const config = cache.getConfig(root);
  const allFiles = getAllProjectFiles(root, {
    additionalIgnoreDirs: config?.ignoreDirs ?? [],
    additionalExtensions: config?.extensions ?? [],
  });
  const unusedFiles = graph.findUnusedFiles(allFiles);
  return text({ unusedFiles, count: unusedFiles.length });
}

/**
 * @description Lists every distinct tag name present in the graph, with how many nodes carry it —
 *   lets an AI discover what `tag:<name>` values exist before querying, instead of guessing and
 *   getting a silent empty result. Includes all tag kinds (declaration, import, marker, comment,
 *   option-bag), not just the subset kept in `query`'s `slim` output.
 * @param cache - Session state holding the cached graph.
 * @param args - `root` selects the graph.
 * @returns TextResponse with `{ tags, count }` where `tags` is `{ name, count }[]` sorted by count descending.
 */
export async function handleListTags(cache: SessionState, args: ListTagsArgs) {
  const { root } = args;
  const graph = await cache.ensureFresh(root);
  const counts = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    for (const tag of node.tags) {
      counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return text({ tags, count: tags.length });
}

/**
 * @description Returns non-test files whose line coverage is below the configured threshold.
 *   Threshold priority: `args.coverageThreshold` → `config.coverageThreshold` → 80.
 *   Requires a prior `analyze` call with `coverageReportPath` set in `mokosh.config`.
 *   Returns an error when no coverage data was loaded rather than treating all files as 0%.
 * @param cache - Session state holding the cached graph and config.
 * @param args - `root` selects the graph; `coverageThreshold` overrides the config default.
 * @returns TextResponse with `{ threshold, uncovered, count }` where each entry includes file path and coverage percentage.
 */
export async function handleFindUncovered(
  cache: SessionState,
  args: FindUncoveredArgs,
): Promise<TextResponse> {
  const { root, coverageThreshold } = args;
  const graph = await cache.ensureFresh(root);
  const config = cache.getConfig(root);
  const threshold = coverageThreshold ?? config?.coverageThreshold ?? 80;

  if (!hasCoverageData(graph)) {
    return text({
      error:
        "No coverage data available. Set coverageReportPath in mokosh.config and call analyze again.",
    });
  }

  const uncovered = [...graph.nodes.values()]
    .filter((node) => node.category !== "test" && node.category !== "config")
    .filter((node) => node.coveragePct !== undefined && node.coveragePct < threshold)
    .map((node) => ({ file: node.path, coveragePct: node.coveragePct as number }));
  return text({ threshold, uncovered, count: uncovered.length });
}

/**
 * @description Returns markdown docs whose referenced files changed more recently than the doc
 *   itself (populated by the `enrichDocDrift` build step). A commit-recency heuristic, not a
 *   content diff — see `docs/adr-009-markdown-parsing.md`. Requires a prior `analyze` call with
 *   `gitStats: true`; otherwise no node has `lastCommitAt` data and nothing is flagged.
 * @param cache - Session state holding the cached graph.
 * @param args - `root` selects the graph.
 * @returns TextResponse with `{ staleDocs: [{ doc, staleFor }], count }`.
 */
export async function handleCheckDocDrift(
  cache: SessionState,
  args: CheckDocDriftArgs,
): Promise<TextResponse> {
  const { root } = args;
  const graph = await cache.ensureFresh(root);

  const staleDocs = [...graph.nodes.values()]
    .filter((node) => node.type === "markdown" && node.staleFor && node.staleFor.length > 0)
    .map((node) => ({ doc: node.path, staleFor: node.staleFor as string[] }));

  return text({ staleDocs, count: staleDocs.length });
}

/**
 * @description Scans every file's per-function complexity breakdown and returns functions/methods
 *   at or above the given threshold, sorted worst-first. Populated for TypeScript/JavaScript, Go,
 *   and Python — files without a `functions` breakdown contribute no results.
 * @param cache - Session state holding the cached graph.
 * @param args - `root` selects the graph; `metric` picks which score to threshold/sort on
 *   (default `cognitiveComplexity`); `threshold` is the minimum score to include (default 10);
 *   `limit` caps the number of results returned (default 20).
 * @returns TextResponse with `{ metric, threshold, functions, count }`.
 */
export async function handleFindComplexFunctions(
  cache: SessionState,
  args: FindComplexFunctionsArgs,
): Promise<TextResponse> {
  const { root, metric = "cognitiveComplexity", threshold = 10, limit = 20 } = args;
  const graph = await cache.ensureFresh(root);
  const functions = findComplexFunctions(graph, { metric, threshold, limit });
  return text({ metric, threshold, functions, count: functions.length });
}

/**
 * @description Finds functions that are complex, in a poorly-covered file, and — when git churn
 *   data is loaded — in a frequently-changed file. Requires a prior `analyze` call with
 *   `coverageReportPath` set in `mokosh.config`; returns an error when no coverage data was
 *   loaded rather than treating all files as 0%. Churn (`gitStats: true`) is optional — when no
 *   node has churn data, the churn filter is skipped and `churnDataAvailable: false` is returned,
 *   since complexity + low coverage alone is still a meaningful signal.
 * @param cache - Session state holding the cached graph and config.
 * @param args - `root` selects the graph; `metric` picks which per-function score to filter/sort
 *   on (default `cognitiveComplexity`); `minComplexity` is the minimum score to include (default
 *   10); `maxCoveragePct` is the maximum containing-file coverage to include (default 50);
 *   `minChurn` is the minimum containing-file 90-day commit count to include (default 0), ignored
 *   when no churn data was loaded; `limit` caps the results (default 20).
 * @returns TextResponse with `{ metric, minComplexity, maxCoveragePct, minChurn, churnDataAvailable, hotspots, count }`.
 */
export async function handleFindRiskHotspots(
  cache: SessionState,
  args: FindRiskHotspotsArgs,
): Promise<TextResponse> {
  const {
    root,
    metric = "cognitiveComplexity",
    minComplexity = 10,
    maxCoveragePct = 50,
    minChurn = 0,
    limit = 20,
  } = args;
  const graph = await cache.ensureFresh(root);

  if (!hasCoverageData(graph)) {
    return text({
      error:
        "No coverage data available. Set coverageReportPath in mokosh.config and call analyze again.",
    });
  }

  const { hotspots, count, churnDataAvailable } = findRiskHotspots(graph, {
    metric,
    minComplexity,
    maxCoveragePct,
    minChurn,
    limit,
  });
  return text({
    metric,
    minComplexity,
    maxCoveragePct,
    minChurn,
    churnDataAvailable,
    hotspots,
    count,
  });
}

/**
 * @description Scans every file in the graph for cross-file (and within-file) duplicated code,
 *   returning the resulting blocks largest-first. Token-based rather than AST-based, so it
 *   covers every language mokosh parses, not just the ones with per-function AST support. Lock
 *   files and files under an ignored directory are excluded even when the graph itself contains
 *   them — `graph.nodes` isn't ignore-rule-filtered for files reached via a resolved reference
 *   rather than the initial FS walk (e.g. a Markdown doc's code-span reference to a build
 *   artifact). Matching runs on a suffix array over the whole candidate token stream
 *   (docs/adr-015-suffix-array-duplicate-detection.md) rather than pairwise comparison, so
 *   results are exact and complete regardless of how repetitive the repo is — no truncation or
 *   skipped-match caveat to report back to the caller.
 * @param cache - Session state holding the cached graph and, if `analyze` set one, this root's
 *   config (read for its `ignoreDirs`).
 * @param args - `root` selects the graph; `minLines` is the minimum block size to report
 *   (default 6); `ignoreLiterals` toggles Type-2 vs Type-1 matching (default true);
 *   `maxPunctuationRatio` gates out blocks that are mostly object/array-literal structural
 *   punctuation rather than substantive shared logic (default 0.5; set 1 to disable);
 *   `ignoreDirs` overrides which directory names are excluded (default: `DEFAULT_IGNORE_DIRS`
 *   merged with this root's configured `ignoreDirs`, if any); `limit` caps the number of results
 *   returned (default 50). Reuses `cache`'s per-root token cache (see
 *   `SessionState.getDuplicationTokenCache`) so files unchanged (by mtime/size) since a prior call
 *   in this session skip re-tokenizing entirely.
 * @returns TextResponse with `{ minLines, groups, count }`.
 */
export async function handleFindDuplicates(
  cache: SessionState,
  args: FindDuplicatesArgs,
): Promise<TextResponse> {
  const { root, minLines = 6, ignoreLiterals = true, maxPunctuationRatio = 0.5, limit = 50 } = args;
  const graph = await cache.ensureFresh(root);
  const ignoreDirs = args.ignoreDirs ?? [
    ...DEFAULT_IGNORE_DIRS,
    ...(cache.getConfig(root)?.ignoreDirs ?? []),
  ];
  const { groups } = await findDuplicates(graph, root, {
    minLines,
    ignoreLiterals,
    maxPunctuationRatio,
    limit,
    ignoreDirs,
    tokenCache: await cache.getDuplicationTokenCache(root),
  });
  cache.flushDuplicationTokenCache(root);
  return text({ minLines, groups, count: groups.length });
}

/**
 * @description Backward-traverses from each changed file to propose what to run.
 *   format='tags' (default) collects tags from transitively dependent test files for CI tag-filtering.
 *   format='paths' returns test file paths ready to pipe to a test runner.
 *   Feature hub files short-circuit traversal and emit a `feature:<name>` tag to prevent explosion.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `changedFiles` overrides git diff detection; `featureThreshold` tunes hub sensitivity; `format` controls output shape.
 * @returns TextResponse with `{ changedFiles, proposedTags }` for tags or `{ changedFiles, affectedTests, count }` for paths.
 */
export async function handleProposeTags(
  cache: SessionState,
  args: ProposeTagsArgs,
): Promise<TextResponse> {
  const { root, changedFiles, base, featureThreshold, format = "tags" } = args;
  const graph = await cache.ensureFresh(root);
  const files =
    changedFiles ??
    new DefaultGitProvider()
      .getChangedFiles(root, base)
      .map((filePath) => path.relative(root, path.resolve(root, filePath)));
  const opts =
    featureThreshold !== undefined
      ? { featureDetection: { minOutDegree: featureThreshold } }
      : undefined;
  if (format === "paths") {
    const affectedTests = proposeAffectedTests(graph, files, opts);
    return text({ changedFiles: files, affectedTests, count: affectedTests.length });
  }
  const tags = proposeTags(graph, files, opts);
  return text({ changedFiles: files, proposedTags: tags });
}

/**
 * @description Identifies feature hub files — source files with high out-degree (many imports) —
 *   sorted by out-degree descending. Builds from `entryPoints` when provided, else reuses the cached graph.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root` is the project directory; `entryPoints` optionally seeds a fresh build; `featureThreshold` sets the minimum out-degree to qualify.
 * @returns TextResponse with `{ features, count }` sorted by out-degree descending.
 */
export async function handleDetectFeatures(
  cache: SessionState,
  args: DetectFeaturesArgs,
): Promise<TextResponse> {
  const { root, entryPoints, featureThreshold } = args;
  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : await cache.ensureFresh(root);
  const featureMap = detectFeatures(
    graph.nodes,
    featureThreshold !== undefined ? { minOutDegree: featureThreshold } : undefined,
  );
  const features = Array.from(featureMap.values()).sort(
    (featureA, featureB) => featureB.outDegree - featureA.outDegree,
  );
  return text({ features, count: features.length });
}

/**
 * @description Filters the graph by category, tag, or path substring and returns matching nodes.
 *   Slim mode (default) strips edge metadata and internal tags for a compact response; pass `slim: false` for full edge data.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root`/`entryPoints` select the graph; `filter` is the query DSL string; `mermaid` switches output to a diagram; `slim` controls response verbosity.
 * @returns TextResponse containing either a Mermaid diagram string or a JSON node list with cycle info.
 */
export async function handleQuery(cache: SessionState, args: QueryArgs): Promise<TextResponse> {
  const { root, entryPoints, filter, mermaid = false, slim = true } = args;
  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : await cache.ensureFresh(root);
  const filtered = filterGraph(graph.serialize(), parseQuery(filter));
  if (mermaid) {
    return text(MermaidExporter.serialize(Graph.deserialize(filtered)));
  }
  if (slim) {
    return text(slimSerialize(filtered));
  }
  return text(filtered);
}

/**
 * @description Lists all workspace packages detected in a monorepo root, including per-package
 *   node counts and cross-package dependency edges. Requires a prior `analyze` call with no entry points.
 * @param cache - Session state holding the cached WorkspaceGraph.
 * @param args - `root` identifies the monorepo root to look up.
 * @returns TextResponse with `{ monorepoType, packageCount, packages }` where each package includes its dependsOn list.
 */
export async function handleGetWorkspacePackages(
  cache: SessionState,
  args: GetWorkspacePackagesArgs,
): Promise<TextResponse> {
  const { root } = args;
  const wg = await cache.ensureFreshWorkspace(root);
  return text(summarizeWorkspacePackages(wg));
}

/**
 * @description Cross-package blast-radius analysis — returns every file that could be affected
 *   if `file` changes, annotated with the package it belongs to. Requires a prior `analyze` call with no entry points.
 * @param cache - Session state holding the cached WorkspaceGraph.
 * @param args - `root` identifies the monorepo; `file` is the changed file (relative to root).
 * @returns TextResponse with `{ file, affected, count }` where each entry includes its package name.
 */
export async function handleGetWorkspaceAffected(
  cache: SessionState,
  args: GetWorkspaceAffectedArgs,
): Promise<TextResponse> {
  const { root, file } = args;
  const wg = await cache.ensureFreshWorkspace(root);
  const affected = wg.getAffectedAcrossPackages(file);
  return text({ file, affected, count: affected.length });
}

/**
 * @description Drops the cached graph for `root` so the next `analyze` call rebuilds from disk.
 *   Call this after editing source files mid-session to prevent stale query results. Config is preserved.
 * @param cache - Session state from which the cached graph will be removed.
 * @param args - `root` identifies which project's cache to invalidate.
 * @returns TextResponse with `{ root, cleared, message }` indicating whether a cache entry was present and removed.
 */
export function handleClearCache(cache: SessionState, args: ClearCacheArgs): TextResponse {
  const { root } = args;
  const cleared = cache.invalidate(root);
  return text({
    root,
    cleared,
    message: cleared
      ? "Cache cleared. Call analyze to rebuild."
      : "No cache was present for this root.",
  });
}

/**
 * @description Returns type-level relationships for the project. Without `type`, returns an inventory
 *   of all interfaces, classes, enums, and type aliases. With `type`, returns which files import that
 *   type and which types the defining file itself imports. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `type` is the exact exported name to look up (omit for full inventory).
 * @returns TextResponse with either a full type inventory or a focused `TypeQueryResult`.
 */
export async function handleGetTypeGraph(
  cache: SessionState,
  args: GetTypeGraphArgs,
): Promise<TextResponse> {
  const { root, type } = args;
  const graph = await cache.ensureFresh(root);
  const typeGraph = buildTypeGraph(graph);
  if (type) {
    return text(queryTypeGraph(typeGraph, type));
  }
  const types = Array.from(typeGraph.types.values());
  return text({ count: types.length, types });
}

/**
 * @description Returns what each file is responsible for: its semantic role, JSDoc description,
 *   exported symbol names, and which feature hub it belongs to. Pass `paths` to filter to specific
 *   files, or omit to get all files. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `paths` filters to specific files; `minOutDegree` tunes hub detection.
 * @returns TextResponse with `{ count, modules }` where each module includes its role, description, and exports.
 */
export async function handleGetModuleResponsibility(
  cache: SessionState,
  args: GetModuleResponsibilityArgs,
): Promise<TextResponse> {
  const { root, paths, minOutDegree } = args;
  const graph = await cache.ensureFresh(root);
  const respGraph = buildResponsibilityGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );
  if (paths?.length) {
    const modules = paths.map((modulePath) => respGraph.get(modulePath)).filter(Boolean);
    return text({ count: modules.length, modules });
  }
  const modules = Array.from(respGraph.values());
  return text({ count: modules.length, modules });
}

/**
 * @description Groups files into feature domains under their respective hub files (high-import
 *   orchestrators). Each file is assigned to the most specific hub that can transitively reach it.
 *   Returns only paths grouped by hub — substantially smaller than a full graph query for the same
 *   domain-based question, though the exact reduction depends on the repo's shape.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `minOutDegree` sets the minimum internal imports to qualify as a hub.
 * @returns TextResponse with `{ features, unassigned }` where `features` is a plain object keyed by feature name.
 */
export async function handleGetFeatureGraph(
  cache: SessionState,
  args: GetFeatureGraphArgs,
): Promise<TextResponse> {
  const { root, minOutDegree } = args;
  const graph = await cache.ensureFresh(root);
  const featureGraph = buildFeatureGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );
  const features = Object.fromEntries(featureGraph.features);
  return text({ features, unassigned: featureGraph.unassigned });
}

/**
 * @description Looks up callers and callees for a named function. Returns the file that defines
 *   the function, all files/functions that call it, and all files/functions it calls. Call edges
 *   are only populated for TypeScript/JavaScript files. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `function` is the exact name of the function to look up.
 * @returns TextResponse with `{ functionName, definedIn, callers, callees }`.
 */
export async function handleGetCallGraph(
  cache: SessionState,
  args: GetCallGraphArgs,
): Promise<TextResponse> {
  const { root, function: functionName } = args;
  const graph = await cache.ensureFresh(root);
  return text(queryCallGraph(graph, functionName));
}

/**
 * @description Finds every file that exports `name`, with the best available usage info per match
 *   (call-edge callers for TS/JS, named-import tracking for Python, whole-file dependents
 *   otherwise). Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `name` is the exact export name to look up.
 * @returns TextResponse with `{ name, matches, count }`.
 */
export async function handleFindSymbol(
  cache: SessionState,
  args: FindSymbolArgs,
): Promise<TextResponse> {
  const { root, name } = args;
  const graph = await cache.ensureFresh(root);
  const matches = findSymbol(graph, name);
  return text({ name, matches, count: matches.length });
}

/**
 * @description Builds the API surface report for a project, expanding `export *` chains so every
 *   symbol accessible to consumers is listed. Partitions the graph into `internalFiles`,
 *   `unreachableFromEntry` (separate consumers or dead-code candidates), and `testFiles`. When `entryPoints` is omitted,
 *   auto-detects them from `package.json` exports/main/module fields. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `entryPoints` are the public entry files (auto-detected when omitted).
 * @returns TextResponse with `{ entryPoints, publicExports, internalFiles, unreachableFromEntry, testFiles }`.
 */
export async function handleGetApiSurface(
  cache: SessionState,
  args: GetApiSurfaceArgs,
): Promise<TextResponse> {
  const { root, entryPoints } = args;
  const graph = await cache.ensureFresh(root);
  const eps = entryPoints?.length ? entryPoints : detectAllEntryPoints(graph, root);
  if (eps.length === 0) {
    throw new Error(
      "No entry points found. Pass entryPoints explicitly or ensure package.json has a main/exports field.",
    );
  }
  return text(buildApiSurface(graph, eps));
}

/**
 * @description Writes `@tag` annotations into every test file reachable from the cached graph.
 *   Only `"import"` and `"comment-marker"` kind tags are written. Tags already present in the
 *   file are excluded from the generated block to avoid duplication. The block is idempotent:
 *   re-running replaces the existing block in place. Supports both TypeScript/JavaScript and
 *   Gherkin `.feature` files with format-appropriate block syntax. Requires a prior `analyze` call.
 * @param {SessionState} cache - Session state holding the cached graph for `root`.
 * @param {ApplyTagsArgs} args - `root` selects the graph; `dryRun` previews changes without disk writes.
 * @returns {Promise<TextResponse>} TextResponse with `ApplyTagsResult`: aggregate counts and per-file status.
 */
export async function handleApplyTags(
  cache: SessionState,
  args: ApplyTagsArgs,
): Promise<TextResponse> {
  const graph = await cache.ensureFresh(args.root);
  const result = await applyTags(graph, args.root, { dryRun: args.dryRun ?? false });
  return text(result);
}
