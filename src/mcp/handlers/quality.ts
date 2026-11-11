import path from "node:path";
import { buildConfigRequired } from "../../config-required";
import {
  compareBranches,
  configToGraphOptions,
  createWorkspaceGraph,
  findComplexFunctions,
  findRiskHotspots,
  getAllProjectFiles,
  hasCoverageData,
  hasGitTimestampData,
  languageCaveats,
  languageSupportNote,
  summarizeBranchComparison,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import { tagPackage } from "./fanout";
import type {
  CheckDocDriftArgs,
  CompareBranchesArgs,
  FindComplexFunctionsArgs,
  FindRiskHotspotsArgs,
  FindUncoveredArgs,
  FindUnusedArgs,
} from "./types";

/**
 * @description Compares the current graph (`root`, kept fresh the same way every other handler
 *   is via `ensureFresh`) against `baseRef` — file diff, exported symbols removed at head that
 *   an importer still references (a likely-missed rename/removal), and deltas across duplication,
 *   complexity, doc drift, and (when coverage is loaded) risk hotspots. The base ref's graph is
 *   built via a temporary `git worktree` and cached to disk by commit sha, so repeat comparisons
 *   against the same base commit are free after the first. Requires a prior `analyze` call.
 *   On a monorepo root both sides are the flattened whole-workspace graph — the base side is a
 *   full `createWorkspaceGraph` in the worktree — so `entryPoints` is rejected there.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root`/`baseRef` identify the comparison; `entryPoints` seeds the base-ref build
 *   (defaults to the entry points from the last `analyze` call; not allowed on a monorepo root);
 *   `detail` (`"summary"`, default, or
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
  const graphOptions = configToGraphOptions(cache.getConfig(root));

  // On a monorepo root there is no single entry-point-seeded graph: the head side is the
  // flattened whole-workspace graph, and the base side is built the same way (a full
  // `createWorkspaceGraph` in the ref's worktree, then flattened) via `workspaceBuilder`.
  if (cache.isWorkspaceRoot(root)) {
    if (args.entryPoints?.length) {
      throw new Error(
        "compare_branches on a monorepo root compares the whole workspace — omit entryPoints. " +
          "To compare one package, point root at that package's directory.",
      );
    }
    const headGraph = (await cache.ensureFreshWorkspace(root)).flatten().graph;
    const comparison = await compareBranches(root, baseRef, headGraph, {
      headRef,
      entryPoints: [],
      minDuplicateLines,
      complexityMetric,
      complexityThreshold,
      maxCoveragePct: args.maxCoveragePct,
      ...graphOptions,
      workspaceBuilder: async (worktreeDir) =>
        (await createWorkspaceGraph(worktreeDir, { silent: true, ...graphOptions })).flatten()
          .graph,
    });
    if (args.detail === "full") return text(comparison);
    return text(
      summarizeBranchComparison(comparison, { metric: complexityMetric, maxItems: args.maxItems }),
    );
  }

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
    ...graphOptions,
  });
  if (args.detail === "full") return text(comparison);
  return text(
    summarizeBranchComparison(comparison, { metric: complexityMetric, maxItems: args.maxItems }),
  );
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
  const { root, entryPoints, package: pkg } = args;
  const config = cache.getConfig(root);
  const allFiles = getAllProjectFiles(root, {
    additionalIgnoreDirs: config?.ignoreDirs ?? [],
    additionalExtensions: config?.extensions ?? [],
    includeNestedRepos: config?.includeNestedRepos ?? false,
  });

  if (!entryPoints && cache.isWorkspaceRoot(root)) {
    // Each package's unused-file scan must only consider files under that package's own root —
    // checking every repo file against one package's (small) graph would flag every other
    // package's files as "unused".
    const wg = await cache.ensureFreshWorkspace(root);
    const targets = pkg
      ? [wg.packages.get(pkg)].filter((entry): entry is NonNullable<typeof entry> => !!entry)
      : Array.from(wg.packages.values());
    if (pkg && targets.length === 0) {
      throw new Error(
        `Unknown workspace package "${pkg}". Call get_workspace_packages to list packages.`,
      );
    }
    const unusedFiles = targets.flatMap(({ graph, pkg: pkgMeta }) => {
      const ownFiles = allFiles.filter(
        (f) => f === pkgMeta.relativeRoot || f.startsWith(`${pkgMeta.relativeRoot}/`),
      );
      return graph.findUnusedFiles(ownFiles);
    });
    return text({ unusedFiles, count: unusedFiles.length });
  }

  const graph = entryPoints
    ? await cache.getOrBuild(
        root,
        entryPoints.map((ep) => path.resolve(root, ep)),
      )
    : await cache.ensureFresh(root);
  const unusedFiles = graph.findUnusedFiles(allFiles);
  return text({ unusedFiles, count: unusedFiles.length });
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
  const { root, coverageThreshold, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const config = cache.getConfig(root);
  const threshold = coverageThreshold ?? config?.coverageThreshold ?? 80;
  const multi = graphs.length > 1;

  if (!graphs.some(({ graph }) => hasCoverageData(graph))) {
    return text(buildConfigRequired({ tool: "find_uncovered", root, missing: "coverage" }));
  }

  const uncovered = graphs.flatMap(({ graph, package: pkgName }) =>
    tagPackage(
      [...graph.nodes.values()]
        .filter((node) => node.category !== "test" && node.category !== "config")
        .filter((node) => node.coveragePct !== undefined && node.coveragePct < threshold)
        .map((node) => ({ file: node.path, coveragePct: node.coveragePct as number })),
      pkgName,
      multi,
    ),
  );
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
  const { root, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;

  // Same convention as find_uncovered / find_risk_hotspots: an explicit error when the data the
  // tool depends on was never loaded, rather than an empty result that reads as "all clear".
  if (!graphs.some(({ graph }) => hasGitTimestampData(graph))) {
    return text(buildConfigRequired({ tool: "check_doc_drift", root, missing: "gitStats" }));
  }

  const staleDocs = graphs.flatMap(({ graph, package: pkgName }) =>
    tagPackage(
      [...graph.nodes.values()]
        .filter((node) => node.type === "markdown" && node.staleFor && node.staleFor.length > 0)
        .map((node) => ({ doc: node.path, staleFor: node.staleFor as string[] })),
      pkgName,
      multi,
    ),
  );

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
  const { root, metric = "cognitiveComplexity", threshold = 10, limit = 20, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  // Each package call takes every match (no limit) so a global sort+limit below reflects the
  // worst functions across the whole workspace, not just each package's own top N.
  const functions = graphs
    .flatMap(({ graph, package: pkgName }) =>
      tagPackage(
        findComplexFunctions(graph, { metric, threshold, limit: multi ? Infinity : limit }),
        pkgName,
        multi,
      ),
    )
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
  const graphList = graphs.map(({ graph }) => graph);
  const note =
    functions.length === 0 ? languageSupportNote(graphList, "functionComplexity") : undefined;
  const caveats = functions.length > 0 ? languageCaveats(graphList, "complexity") : [];
  return text({
    metric,
    threshold,
    functions,
    count: functions.length,
    ...(note && { note }),
    ...(caveats.length > 0 && { caveats }),
  });
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
    package: pkg,
  } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;

  if (!graphs.some(({ graph }) => hasCoverageData(graph))) {
    return text(buildConfigRequired({ tool: "find_risk_hotspots", root, missing: "coverage" }));
  }

  const perPackage = graphs.map(({ graph, package: pkgName }) => ({
    pkgName,
    // Same reasoning as find_complex_functions: take every match per package, then sort+limit once globally.
    ...findRiskHotspots(graph, {
      metric,
      minComplexity,
      maxCoveragePct,
      minChurn,
      limit: multi ? Infinity : limit,
    }),
  }));
  const hotspots = perPackage
    .flatMap(({ hotspots: pkgHotspots, pkgName }) => tagPackage(pkgHotspots, pkgName, multi))
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
  const churnDataAvailable = perPackage.some((p) => p.churnDataAvailable);
  const caveats =
    hotspots.length > 0
      ? languageCaveats(
          graphs.map(({ graph }) => graph),
          "complexity",
        )
      : [];
  return text({
    metric,
    minComplexity,
    maxCoveragePct,
    minChurn,
    churnDataAvailable,
    hotspots,
    count: hotspots.length,
    ...(caveats.length > 0 && { caveats }),
  });
}
