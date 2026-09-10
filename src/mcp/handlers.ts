import path from "node:path";
import { DefaultGitProvider } from "../git";
import {
  type ApiSurface,
  type ApiSurfaceSummary,
  applyConfig,
  applyTags,
  buildApiSurface,
  buildFeatureGraph,
  buildResponsibilityGraph,
  buildTypeGraph,
  type CycleEdgeKind,
  compareBranches,
  configToGraphOptions,
  createWorkspaceGraph,
  DEFAULT_IGNORE_DIRS,
  type DuplicateQuery,
  type DuplicatesSummary,
  type DuplicationResultParams,
  dedupeGroupsAgainstClusters,
  detectAllEntryPoints,
  detectFeatures,
  duplicationDigest,
  duplicationResultCacheKey,
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
  hasGitTimestampData,
  languageCaveats,
  languageCaveatsSummary,
  languageSupportNote,
  loadCoverageMap,
  loadDuplicationResult,
  loadMokoshConfig,
  MermaidExporter,
  type PublicExport,
  parseDupQuery,
  parseQuery,
  proposeAffectedTests,
  proposeTags,
  queryCallGraph,
  queryChangeImpact,
  queryTypeGraph,
  saveDuplicationResult,
  slimDupCluster,
  slimDupGroup,
  slimSerialize,
  sortLimitDupGroups,
  summarizeApiSurface,
  summarizeBranchComparison,
  summarizeDuplicates,
  summarizeWorkspaceLayout,
} from "../index";
import type { SessionState } from "./cache";
import type { TextResponse } from "./utils";
import { text } from "./utils";

/** Floor for how many duplicate matches `find_duplicates` keeps per package before the
 *  cross-package global sort (used when it exceeds `limit * 4`). Bounds per-package retention
 *  without truncating so aggressively that the global ranking loses real top hits. */
const FIND_DUPLICATES_PER_PACKAGE_CAP = 500;

/** Byte ceiling for the serialized `find_duplicates` response (~30K tokens). Past this the
 *  group/cluster lists are halved until the payload fits and the result is flagged `truncated`.
 *  A hard backstop only — the response is summary-first and low-limit by default, so this
 *  rarely engages. */
const FIND_DUPLICATES_MAX_PAYLOAD_BYTES = 120_000;

/** Cluster count in the default (no `filter`, no `view`) `find_duplicates` response — a fixed,
 *  cheap triage ceiling independent of repo size. Narrow with `filter` for more. */
const FIND_DUPLICATES_PREVIEW_LIMIT = 8;

// ---------------------------------------------------------------------------
// Argument types — one per tool, matching the schemas defined in tools.ts
// ---------------------------------------------------------------------------

export type AnalyzeArgs = {
  root: string;
  entryPoints: string[];
  /** Monorepo only: build every package graph before returning, instead of the fast
   *  layout-only response. Restores the pre-progressive `{ nodeCount, categories, cycles }`
   *  payload. Ignored for single-package roots. */
  eager?: boolean;
  /** Monorepo only: restrict the (eager or lazily-triggered) build to these package names
   *  or relative roots — the escape hatch for very large monorepos. */
  packages?: string[];
  /** Cycle edge kinds to include that are otherwise filtered from the `cycles` output:
   *  `"docReference"` (Markdown doc cross-links), `"samePackage"` (JVM same-package siblings).
   *  Default: none. */
  cycleKinds?: CycleEdgeKind[];
};
export type GetWorkspacePackagesArgs = { root: string };
export type GetWorkspaceAffectedArgs = {
  root: string;
  file: string;
  maxFilesPerPackage?: number;
};
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
export type FindSymbolArgs = { root: string; name: string; package?: string };
export type FindUnusedArgs = { root: string; entryPoints?: string[]; package?: string };
export type FindUncoveredArgs = { root: string; coverageThreshold?: number; package?: string };
export type ListTagsArgs = { root: string; package?: string };
export type CheckDocDriftArgs = { root: string; package?: string };
export type FindComplexFunctionsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  threshold?: number;
  limit?: number;
  package?: string;
};
export type FindRiskHotspotsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  minComplexity?: number;
  maxCoveragePct?: number;
  minChurn?: number;
  limit?: number;
  package?: string;
};
export type FindDuplicatesArgs = {
  root: string;
  minLines?: number;
  ignoreLiterals?: boolean;
  maxPunctuationRatio?: number;
  limit?: number;
  ignoreDirs?: string[];
  includeGenerated?: boolean;
  includeSameFile?: boolean;
  includeSvgMarkup?: boolean;
  includeDocs?: boolean;
  scope?: "src" | "tests" | "all";
  /** `key:value` result filter — see `src/query/dup-parser.ts` / `DuplicateQuery`. */
  filter?: string;
  /** Which lists the response carries. `"summary"` (default) → `summary` + a small `clusters`
   *  preview + a `hint`, no `groups`; a `filter` with no `view` → `summary` + matching
   *  `clusters` only. `"groups"` → `summary` + raw `groups` (the per-span shape), no `clusters`.
   *  `"full"` → both, with `groups` de-duped against the returned multi-member clusters. */
  view?: "summary" | "groups" | "full";
  /** Compact response shape (default true): per-group `{ lines, score, family, kind, defKind,
   *  occurrences: ["path:start-end"], signals }` and per-cluster metadata (incl. `longestMatchAt`)
   *  without nested group bodies. `false` returns the full objects. */
  slim?: boolean;
  package?: string;
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
  package?: string;
};
export type QueryArgs = {
  root: string;
  entryPoints?: string[];
  filter: string;
  mermaid?: boolean;
  slim?: boolean;
  package?: string;
};

export type ClearCacheArgs = { root: string };
export type GetTypeGraphArgs = { root: string; type?: string; package?: string };
export type GetModuleResponsibilityArgs = {
  root: string;
  paths?: string[];
  minOutDegree?: number;
  package?: string;
};
export type GetFeatureGraphArgs = { root: string; minOutDegree?: number; package?: string };
export type GetCallGraphArgs = { root: string; function: string; package?: string };
export type GetApiSurfaceArgs = {
  root: string;
  entryPoints?: string[];
  package?: string;
  maxExportsPerPackage?: number;
  /**
   * Shape of the single-surface response (plain root, or a single requested `package`).
   * `"summary"` (default) → token-bounded {@link ApiSurfaceSummary}: counts, a capped
   * `{name,kind}` export sample, `byKind`, and the (short) `unreachableFromEntry` list.
   * `"exports"` → the summary plus the full `publicExports` array (docs, signatures, definedIn).
   * `"full"` → the complete {@link ApiSurface} (all export detail + every path list).
   * Ignored by the compact multi-package breakdown.
   */
  view?: "summary" | "exports" | "full";
  /** `view:"summary"` only: cap the `publicExports` sample (default 30). */
  maxExports?: number;
};
export type ApplyTagsArgs = { root: string; dryRun?: boolean; package?: string };

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
// Workspace fan-out helpers
//
// Whole-graph tools resolve one Graph per package via `cache.resolveGraphs` (a single entry,
// `package: ""`, on a non-monorepo root) and run their existing per-graph logic once per entry.
// These helpers merge the per-package results back into one response — concatenation only,
// never a merged Graph.
// ---------------------------------------------------------------------------

/** Adds a `package` field to each `{ path }`-shaped result, looked up in `packageOf`. A no-op
 *  when `packageOf` is empty (plain, non-workspace root) so single-package output is untouched. */
function withPackageMeta<T extends { path: string }>(
  items: T[],
  packageOf: Map<string, string>,
): Array<T & { package?: string }> {
  if (packageOf.size === 0) return items;
  return items.map((item) => {
    const pkg = packageOf.get(item.path);
    return pkg ? { ...item, package: pkg } : item;
  });
}

/** Tags each item in a list-shaped result with its owning package, but only when more than one
 *  package graph was actually queried — a single/non-monorepo result stays untouched. */
function tagPackage<T extends object>(
  items: T[],
  pkg: string,
  multi: boolean,
): Array<T & { package?: string }> {
  return multi && pkg ? items.map((item) => ({ ...item, package: pkg })) : items;
}

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
    const layout = cache.getLayout(root);
    if (layout.type !== "none") {
      const config = cache.getConfig(root);
      const buildOpts = { ...configToGraphOptions(config), packages: args.packages };
      cache.storeLastAnalyze(root, { kind: "workspace" });
      cache.startWatching(root);

      // Progressive default: return the layout immediately and let the per-package graphs
      // build lazily on the first workspace query that needs edges. Full-repo graph builds
      // on large JVM monorepos blow the MCP request timeout, and most sessions only need
      // the package list (see docs/known_issues/02-monorepo-empty-entrypoints-timeout.md).
      if (!args.eager) {
        const builtGraph = cache.hasWorkspace(root) ? cache.requireWorkspace(root) : undefined;
        return text(summarizeWorkspaceLayout(layout, builtGraph));
      }

      const workspaceGraph = await cache.getOrBuildWorkspace(root, buildOpts);
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
  const cycles = graph.findCycles({ includeKinds: args.cycleKinds });
  const languageCoverage = getLanguageCoverage(graph);
  const caveats = languageCaveatsSummary(graph);
  return text({
    nodeCount: serialized.nodes.length,
    categories,
    cycles,
    languageCoverage,
    ...(caveats.length > 0 && { caveats }),
  });
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
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const deps = getDependencies(graph, file, depth);
  const withMetaDeps = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  const dependencies = withPackageMeta(withMetaDeps, packageOf);
  const caveats = languageCaveats(graph, "importResolution");
  return text({ file, dependencies, ...(caveats.length > 0 && { caveats }) });
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
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const deps = getDependents(graph, file);
  const withMetaDeps = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  const dependents = withPackageMeta(withMetaDeps, packageOf);
  const caveats = languageCaveats(graph, "importResolution");
  return text({ file, dependents, ...(caveats.length > 0 && { caveats }) });
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
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const annotate = (paths: string[]) =>
    withMeta
      ? withPackageMeta(
          paths.map((p) => ({ path: p, ...getNodeMeta(graph, p) })),
          packageOf,
        )
      : paths;

  if (cached) {
    const impactCache = await cache.getOrBuildChangeImpactForFile(root, file, graph);
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
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const rawCallers = getCallers(graph, file, { depth, withEdgeDetail });
  const callers =
    packageOf.size === 0
      ? rawCallers
      : rawCallers.map((entry) => {
          const pkg = packageOf.get(entry.file);
          return pkg ? { ...entry, package: pkg } : entry;
        });
  const note = callers.length === 0 ? languageSupportNote(graph, "callEdges") : undefined;
  const caveats = callers.length > 0 ? languageCaveats(graph, "callEdges") : [];
  return text({
    file,
    callers,
    count: callers.length,
    ...(note && { note }),
    ...(caveats.length > 0 && { caveats }),
  });
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
 * @description Lists every distinct tag name present in the graph, with how many nodes carry it —
 *   lets an AI discover what `tag:<name>` values exist before querying, instead of guessing and
 *   getting a silent empty result. Includes all tag kinds (declaration, import, marker, comment,
 *   option-bag), not just the subset kept in `query`'s `slim` output.
 * @param cache - Session state holding the cached graph.
 * @param args - `root` selects the graph.
 * @returns TextResponse with `{ tags, count }` where `tags` is `{ name, count }[]` sorted by count descending.
 */
export async function handleListTags(cache: SessionState, args: ListTagsArgs) {
  const { root, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const counts = new Map<string, number>();
  for (const { graph } of graphs) {
    for (const node of graph.nodes.values()) {
      for (const tag of node.tags) {
        counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
      }
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
  const { root, coverageThreshold, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const config = cache.getConfig(root);
  const threshold = coverageThreshold ?? config?.coverageThreshold ?? 80;
  const multi = graphs.length > 1;

  if (!graphs.some(({ graph }) => hasCoverageData(graph))) {
    return text({
      error:
        "No coverage data available. Set coverageReportPath in mokosh.config and call analyze again.",
    });
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
    return text({
      error:
        "No git-stats data available. Set gitStats: true in mokosh.config and call analyze again.",
    });
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
    return text({
      error:
        "No coverage data available. Set coverageReportPath in mokosh.config and call analyze again.",
    });
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

/** The one-line drill-in nudge carried on a default (summary) `find_duplicates` response —
 *  turns the `summary` counts into concrete next-call suggestions so the `filter` / `view` path
 *  actually gets used instead of the caller re-requesting the whole list. */
function buildDuplicatesHint(summary: DuplicatesSummary): string {
  const dirCount = Object.keys(summary.byTopDir).length;
  const families = Object.keys(summary.byFamily).filter((family) => family !== "other");
  const familyEg = families.length > 1 ? ` or filter:"family:${families[0]},sort:score"` : "";
  return (
    `${summary.matched} duplicate group${summary.matched === 1 ? "" : "s"} across ` +
    `${dirCount} ${dirCount === 1 ? "dir" : "dirs"}; showing the top clusters. ` +
    `Narrow with filter, e.g. filter:"path:src,minScore:15"${familyEg}. ` +
    `Pass view:"groups" for raw spans or view:"full" for both lists.`
  );
}

/**
 * @description Scans every file in the graph for cross-file (and within-file) duplicated code.
 *   Token-based rather than AST-based, so it covers every language mokosh parses. Matching runs
 *   on a suffix array over the whole candidate token stream
 *   (docs/adr-015-suffix-array-duplicate-detection.md) — exact and complete regardless of how
 *   repetitive the repo is.
 *
 *   **Summary-first response.** With no `filter` and no `view` the response is just `summary` +
 *   a small `clusters` preview (`FIND_DUPLICATES_PREVIEW_LIMIT`) + a `hint` — no `groups`, since
 *   every group in a multi-member cluster is redundant with it. Pass a `filter` for `summary` +
 *   matching `clusters`; `view: "groups"` for the raw per-span `groups`; `view: "full"` for both
 *   (with `groups` de-duped against the returned clusters). Each slim cluster carries
 *   `longestMatchAt` — the `"path:start-end"` span of its biggest match — so it is actionable
 *   without the `groups` list.
 *
 *   **Result cache.** When no `filter` is given, the full pre-`limit` `{ groups, clusters }` is
 *   read from / written to `mokosh-cache/duplication-result.json` (per package on a monorepo),
 *   keyed by a digest of every graph node's mtime/size plus the output-affecting scan params
 *   (`src/graph/duplication/result-cache-store.ts`). An unchanged repo skips the scan entirely;
 *   any file edit, add, remove, or param change forces a recompute. A `filter` run always
 *   scans (it is the explicit drill-in path).
 * @param cache - Session state holding the cached graph and, if `analyze` set one, this root's
 *   config (read for `ignoreDirs` / `duplication.*`).
 * @param args - `root` selects the graph; `minLines` (default 6), `ignoreLiterals` (default
 *   true), `maxPunctuationRatio` (default 0.5), `ignoreDirs`, `includeGenerated`,
 *   `includeSameFile`, `includeSvgMarkup`, `includeDocs`, `scope` tune the scan; `filter` is the
 *   `key:value` DSL (`src/query/dup-parser.ts`); `view` (`"summary"` default | `"groups"` |
 *   `"full"`) picks which lists come back; `slim` (default true) compacts each item; `limit`
 *   caps the non-preview lists (default 20).
 * @returns TextResponse with `{ minLines, filter?, summary, clusters?, groups?, count?, hint?,
 *   truncated? }`. `summary` (`{ matched, byFamily, byTopDir, bySignal, largestLines,
 *   clusteredGroups? }`) is the whole post-`filter`, pre-`limit` view.
 */
export async function handleFindDuplicates(
  cache: SessionState,
  args: FindDuplicatesArgs,
): Promise<TextResponse> {
  const {
    root,
    minLines = 6,
    ignoreLiterals = true,
    maxPunctuationRatio = 0.5,
    limit = 20,
    filter,
    slim = true,
    package: pkg,
  } = args;
  // Parse the filter DSL up front so a malformed string fails before the (expensive) scan.
  const dupQuery: DuplicateQuery | undefined = filter ? parseDupQuery(filter) : undefined;
  const effectiveLimit = dupQuery?.limit ?? limit;

  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const config = cache.getConfig(root);
  const ignoreDirs = args.ignoreDirs ?? [...DEFAULT_IGNORE_DIRS, ...(config?.ignoreDirs ?? [])];
  // Scan packages one at a time, not via Promise.all: each findDuplicates call spins up its own
  // tokenizing worker pool and builds a full suffix array + LCP arrays per language family, so N
  // concurrent scans on a large monorepo hold N of those live at once and exhaust the heap.
  // Each package is capped above the response limit (so the cross-package global sort below and
  // the cached "full" result stay accurate) but finite — a single package can otherwise retain
  // tens of thousands of DuplicateGroup objects.
  const perPackageCap =
    multi || dupQuery
      ? Math.max(effectiveLimit * 4, FIND_DUPLICATES_PER_PACKAGE_CAP)
      : Math.max(effectiveLimit, FIND_DUPLICATES_PER_PACKAGE_CAP);
  // Resolve every output-affecting knob once — both the scan call and the result-cache key read
  // from these, so they can never drift.
  const scanOpts = {
    includeGenerated: args.includeGenerated ?? config?.duplication?.includeGenerated ?? false,
    includeSameFile: args.includeSameFile ?? config?.duplication?.includeSameFile ?? false,
    includeSvgMarkup: args.includeSvgMarkup ?? config?.duplication?.includeSvgMarkup ?? false,
    includeDocs: args.includeDocs ?? config?.duplication?.includeDocs ?? false,
    scope: args.scope ?? config?.duplication?.scope,
    ignoreGlobs: config?.duplication?.ignoreGlobs ?? [],
  };
  const resultParams: DuplicationResultParams = {
    minLines,
    ignoreLiterals,
    maxPunctuationRatio,
    limit: perPackageCap,
    scope: scanOpts.scope,
    includeGenerated: scanOpts.includeGenerated,
    includeSameFile: scanOpts.includeSameFile,
    includeSvgMarkup: scanOpts.includeSvgMarkup,
    includeDocs: scanOpts.includeDocs,
    ignoreDirs,
    ignoreGlobs: scanOpts.ignoreGlobs,
  };
  const paramsKey = duplicationResultCacheKey(resultParams);
  // The result cache only holds an unfiltered scan — a `filter` run always re-scans (predicate
  // keys are applied inside `findDuplicates`, pre-clustering).
  const useResultCache = filter === undefined;

  const tokenCache = await cache.getDuplicationTokenCache(root);
  type DupScan = Awaited<ReturnType<typeof findDuplicates>>;
  const perPackage: Array<{ groups: DupScan["groups"]; clusters: DupScan["clusters"] }> = [];
  let didScan = false;
  for (const { graph, package: pkgName } of graphs) {
    const resultCachePath = cache.duplicationResultCachePath(root, multi ? pkgName : undefined);
    const digest = useResultCache ? duplicationDigest(graph.nodes.values()) : "";
    const cached = useResultCache
      ? loadDuplicationResult(resultCachePath, digest, paramsKey)
      : null;
    if (cached) {
      perPackage.push({
        groups: tagPackage(cached.groups, pkgName, multi),
        clusters: tagPackage(cached.clusters, pkgName, multi),
      });
      continue;
    }
    didScan = true;
    const { groups, clusters } = await findDuplicates(graph, root, {
      minLines,
      ignoreLiterals,
      maxPunctuationRatio,
      limit: perPackageCap,
      ignoreDirs,
      includeGenerated: scanOpts.includeGenerated,
      includeSameFile: scanOpts.includeSameFile,
      includeSvgMarkup: scanOpts.includeSvgMarkup,
      includeDocs: scanOpts.includeDocs,
      scope: scanOpts.scope,
      ignoreGlobs: scanOpts.ignoreGlobs,
      // Predicate keys only — the DSL's sort/limit are applied after the per-package merge below.
      ...(filter !== undefined && { filter }),
      tokenCache,
    });
    if (useResultCache) {
      saveDuplicationResult(resultCachePath, digest, paramsKey, groups, clusters);
    }
    perPackage.push({
      groups: tagPackage(groups, pkgName, multi),
      clusters: tagPackage(clusters, pkgName, multi),
    });
  }
  if (didScan) cache.flushDuplicationTokenCache(root);

  const mergedGroups = perPackage.flatMap((result) => result.groups);
  // Summary is computed from the full merged, post-`filter`, pre-`limit` set — a lower bound on a
  // huge monorepo where the per-package cap clipped, exact otherwise.
  const summary = summarizeDuplicates(mergedGroups);

  // DSL `sort` (lines | score | occurrences, asc/desc) when given; otherwise the historical
  // largest-`lines`-first order.
  const orderedGroups = dupQuery?.sort
    ? sortLimitDupGroups(mergedGroups, dupQuery)
    : [...mergedGroups].sort((a, b) => b.lines - a.lines);
  const orderedClusters = perPackage
    .flatMap((result) => result.clusters)
    .sort((a, b) => b.longestMatch - a.longestMatch || b.matchCount - a.matchCount);

  const view = args.view ?? "summary";
  // The bare default: no `filter`, no explicit `view`. Only this shape gets the cluster preview
  // cap and the `hint`.
  const bareDefault = filter === undefined && args.view === undefined;
  const wantGroups = view === "groups" || view === "full";
  const wantClusters = view !== "groups";

  const clusterCap = bareDefault ? FIND_DUPLICATES_PREVIEW_LIMIT : effectiveLimit;
  let clusters = wantClusters ? orderedClusters.slice(0, clusterCap) : [];

  let groups: typeof orderedGroups = [];
  let clusteredGroups: number | undefined;
  if (wantGroups) {
    if (view === "full") {
      // The only path returning both lists — drop groups already covered by a returned
      // multi-member cluster so the two lists don't restate each other.
      const deduped = dedupeGroupsAgainstClusters(orderedGroups, clusters);
      clusteredGroups = orderedGroups.length - deduped.length;
      groups = deduped.slice(0, effectiveLimit);
    } else {
      groups = orderedGroups.slice(0, effectiveLimit);
    }
  }
  const responseSummary: DuplicatesSummary =
    clusteredGroups !== undefined ? { ...summary, clusteredGroups } : summary;

  // A result with thousands of large groups can itself be megabytes of JSON. Trim whichever
  // lists are present (measuring the shape actually emitted) until the payload fits.
  const shapeGroups = () => (slim ? groups.map(slimDupGroup) : groups);
  const shapeClusters = () => (slim ? clusters.map(slimDupCluster) : clusters);
  let truncated = false;
  while (
    (groups.length > 1 || clusters.length > 1) &&
    JSON.stringify({
      minLines,
      summary: responseSummary,
      groups: shapeGroups(),
      clusters: shapeClusters(),
    }).length > FIND_DUPLICATES_MAX_PAYLOAD_BYTES
  ) {
    groups = groups.slice(0, Math.max(1, Math.floor(groups.length / 2)));
    clusters = clusters.slice(0, Math.max(1, Math.floor(clusters.length / 2)));
    truncated = true;
  }

  // `duplication` fidelity is `partial` for every non-CSS language (the generic token pipeline),
  // so `languageCaveats` stays quiet there unless a language carries a concrete note (e.g. Stylus:
  // no shared PostCSS AST).
  const caveats = languageCaveats(
    graphs.map(({ graph }) => graph),
    "duplication",
  );

  return text({
    minLines,
    ...(filter !== undefined && { filter }),
    summary: responseSummary,
    ...(wantClusters && { clusters: shapeClusters() }),
    ...(wantGroups && { groups: shapeGroups(), count: groups.length }),
    ...(bareDefault && { hint: buildDuplicatesHint(summary) }),
    ...(caveats.length > 0 && { caveats }),
    ...(truncated && { truncated }),
  });
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
  const files =
    changedFiles ??
    new DefaultGitProvider()
      .getChangedFiles(root, base)
      .map((filePath) => path.relative(root, path.resolve(root, filePath)));
  const opts =
    featureThreshold !== undefined
      ? { featureDetection: { minOutDegree: featureThreshold } }
      : undefined;

  // Changed files can span multiple workspace packages in one PR — each file's blast radius
  // only makes sense traversed within its own package's graph, so group by owning package
  // rather than exposing a `package` arg the caller would have to pre-partition themselves.
  const fileGroups = cache.isWorkspaceRoot(root)
    ? await groupFilesByPackage(cache, root, files)
    : [{ graph: await cache.ensureFresh(root), files }];

  if (format === "paths") {
    const affectedTests = [
      ...new Set(
        fileGroups.flatMap(({ graph, files: groupFiles }) =>
          proposeAffectedTests(graph, groupFiles, opts),
        ),
      ),
    ];
    return text({ changedFiles: files, affectedTests, count: affectedTests.length });
  }
  const tags = [
    ...new Set(
      fileGroups.flatMap(({ graph, files: groupFiles }) => proposeTags(graph, groupFiles, opts)),
    ),
  ];
  return text({ changedFiles: files, proposedTags: tags });
}

/**
 * @description Partitions `files` by the workspace package that owns each one, pairing each
 *   group with that package's `Graph` — so `propose_tags`/`propose_affected_tests` traverse each
 *   changed file within its own package rather than a merged graph. Files that don't fall under
 *   any known package are dropped (silently — an untracked/deleted path is common in a diff and
 *   isn't an error here).
 * @param cache - Session state holding the workspace graph for `root`.
 * @param root - Absolute monorepo root path.
 * @param files - Root-relative changed-file paths.
 * @returns One `{ graph, files }` group per package that owns at least one of `files`.
 */
async function groupFilesByPackage(
  cache: SessionState,
  root: string,
  files: string[],
): Promise<Array<{ graph: Graph; files: string[] }>> {
  const wg = await cache.ensureFreshWorkspace(root);
  const byPackage = new Map<string, string[]>();
  for (const file of files) {
    const pkg = wg.getPackageForFile(file);
    if (!pkg) continue;
    const group = byPackage.get(pkg.name);
    if (group) group.push(file);
    else byPackage.set(pkg.name, [file]);
  }
  return Array.from(byPackage.entries())
    .map(([pkgName, pkgFiles]) => ({ graph: wg.packages.get(pkgName)?.graph, files: pkgFiles }))
    .filter((group): group is { graph: Graph; files: string[] } => !!group.graph);
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
  const { root, entryPoints, featureThreshold, package: pkg } = args;
  const opts = featureThreshold !== undefined ? { minOutDegree: featureThreshold } : undefined;

  if (entryPoints) {
    const graph = await cache.getOrBuild(
      root,
      entryPoints.map((ep) => path.resolve(root, ep)),
    );
    const featureMap = detectFeatures(graph.nodes, opts);
    const features = Array.from(featureMap.values()).sort((a, b) => b.outDegree - a.outDegree);
    return text({ features, count: features.length });
  }

  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const features = graphs
    .flatMap(({ graph, package: pkgName }) =>
      tagPackage(Array.from(detectFeatures(graph.nodes, opts).values()), pkgName, multi),
    )
    .sort((a, b) => b.outDegree - a.outDegree);
  return text({ features, count: features.length });
}

/**
 * @description Filters the graph by category, tag, or path substring and returns matching nodes.
 *   On a monorepo root the filter runs once against the flattened whole-workspace graph, so
 *   `sort`/`limit` rank globally and cross-package import edges are retained; each result node
 *   carries its owning `package`, and the `package:` query key (or the `package` arg) narrows to
 *   one. Slim mode (default) strips edge metadata and internal tags for a compact response; pass
 *   `slim: false` for full edge data.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root`/`entryPoints` select the graph; `filter` is the query DSL string; `package` narrows to one workspace package; `mermaid` switches output to a diagram; `slim` controls response verbosity.
 * @returns TextResponse containing either a Mermaid diagram string or a JSON node list with cycle info.
 */
export async function handleQuery(cache: SessionState, args: QueryArgs): Promise<TextResponse> {
  const { root, entryPoints, filter, mermaid = false, slim = true, package: pkg } = args;

  if (entryPoints) {
    const graph = await cache.getOrBuild(
      root,
      entryPoints.map((ep) => path.resolve(root, ep)),
    );
    return textQueryResult(graph, filter, mermaid, slim);
  }

  const { graph, packageOf } = await cache.resolveFlatGraph(root, pkg);
  return textQueryResult(graph, filter, mermaid, slim, packageOf);
}

/** Formats a single-graph query result — shared by `handleQuery`'s entryPoints and
 *  flattened-workspace branches. `packageOf` (empty on a plain root) enables the `package:`
 *  filter key and stamps each result node with its owning package. */
function textQueryResult(
  graph: Graph,
  filter: string,
  mermaid: boolean,
  slim: boolean,
  packageOf: Map<string, string> = new Map(),
): TextResponse {
  const filtered = filterGraph(graph.serialize(), parseQuery(filter), { packageOf });
  if (mermaid) {
    return text(MermaidExporter.serialize(Graph.deserialize(filtered)));
  }
  return text(slim ? slimSerialize(filtered) : filtered);
}

/**
 * @description Lists all workspace packages detected in a monorepo root. Answers from the
 *   detected layout and `package.json` manifests alone — no dependency-graph build — so it
 *   returns in well under a second even on large monorepos (see
 *   docs/known_issues/01-monorepo-workspace-packages-timeout.md). Per-package `nodeCount` and,
 *   for build-system monorepos without manifests, exact `dependsOn` are filled in only when a
 *   workspace graph is already cached from a prior `analyze` call.
 * @param cache - Session state; consulted for an already-built workspace graph, never triggers one.
 * @param args - `root` identifies the monorepo root to look up.
 * @returns TextResponse with `{ monorepoType, packageCount, packages, dependsOnResolved, nodeCountsResolved }`.
 */
export async function handleGetWorkspacePackages(
  cache: SessionState,
  args: GetWorkspacePackagesArgs,
): Promise<TextResponse> {
  const { root } = args;
  const layout = cache.getLayout(root);
  if (layout.type === "none") {
    throw new Error(
      `${root} is not a recognized monorepo root (no pnpm/npm/yarn/Nx/Turborepo/Gradle/sbt workspace detected).`,
    );
  }
  const builtGraph = cache.hasWorkspace(root) ? cache.requireWorkspace(root) : undefined;
  return text(summarizeWorkspaceLayout(layout, builtGraph));
}

/**
 * @description Cross-package blast-radius analysis — the files affected if `file` changes,
 *   grouped by owning package with each package's file list capped so the response stays small
 *   on large monorepos (where the raw blast radius can be most of the repo). For the full,
 *   uncapped list of affected files in one package, call `get_affected` on `file` (it now spans
 *   the whole workspace) or narrow with a `query`. Requires a prior `analyze` call with no entry points.
 * @param cache - Session state holding the cached WorkspaceGraph.
 * @param args - `root` identifies the monorepo; `file` is the changed file (relative to root);
 *   `maxFilesPerPackage` caps each package's `sample` list (default 10; 0 = counts only).
 * @returns TextResponse with a `WorkspaceAffectedSummary`: `{ file, totalAffected, packageCount, byPackage, truncated }`.
 */
export async function handleGetWorkspaceAffected(
  cache: SessionState,
  args: GetWorkspaceAffectedArgs,
): Promise<TextResponse> {
  const { root, file, maxFilesPerPackage } = args;
  const wg = await cache.ensureFreshWorkspace(root);
  const summary = wg.summarizeAffectedAcrossPackages(
    file,
    maxFilesPerPackage !== undefined ? { maxFilesPerPackage } : {},
  );
  return text(summary);
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
 *   type and which types the defining file itself imports. On a monorepo root this spans the whole
 *   workspace (flattened graph); pass `package` to scope it to one. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `type` is the exact exported name to look up (omit for full inventory); `package` scopes to one workspace package.
 * @returns TextResponse with either a full type inventory or a focused `TypeQueryResult`.
 */
export async function handleGetTypeGraph(
  cache: SessionState,
  args: GetTypeGraphArgs,
): Promise<TextResponse> {
  const { root, type, package: pkg } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
  const typeGraph = buildTypeGraph(graph);
  if (type) {
    return text(queryTypeGraph(typeGraph, type));
  }
  const types = Array.from(typeGraph.types.values());
  const note = types.length === 0 ? languageSupportNote(graph, "typeGraph") : undefined;
  return text({ count: types.length, types, ...(note && { note }) });
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
  const { root, paths, minOutDegree, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const opts = minOutDegree !== undefined ? { minOutDegree } : undefined;
  const modules = graphs.flatMap(({ graph, package: pkgName }) => {
    const respGraph = buildResponsibilityGraph(graph, opts);
    const found = paths?.length
      ? paths
          .map((modulePath) => respGraph.get(modulePath))
          .filter((module): module is NonNullable<typeof module> => !!module)
      : Array.from(respGraph.values());
    return tagPackage(found, pkgName, multi);
  });
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
  const { root, minOutDegree, package: pkg } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
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
  const { root, function: functionName, package: pkg } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
  const result = queryCallGraph(graph, functionName);
  const empty = result.callers.length === 0 && result.callees.length === 0;
  const note = empty ? languageSupportNote(graph, "callEdges") : undefined;
  const caveats = empty ? [] : languageCaveats(graph, "callEdges");
  return text({ ...result, ...(note && { note }), ...(caveats.length > 0 && { caveats }) });
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
  const { root, name, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const matches = graphs.flatMap(({ graph, package: pkgName }) =>
    tagPackage(findSymbol(graph, name), pkgName, multi),
  );
  // Per-match precision already varies (call-edge callers for TS/JS, import tracking for Python,
  // whole-file dependents otherwise); the caveat says which languages can't reach call-level.
  const caveats =
    matches.length > 0
      ? languageCaveats(
          graphs.map(({ graph }) => graph),
          "callEdges",
        )
      : [];
  return text({ name, matches, count: matches.length, ...(caveats.length > 0 && { caveats }) });
}

/**
 * @description Builds the API surface report for a project, expanding `export *` chains so every
 *   symbol accessible to consumers is listed. Partitions the graph into `internalFiles`,
 *   `unreachableFromEntry` (separate consumers or dead-code candidates), and `testFiles`.
 *   `package.json` `bin` targets count as entry points alongside `exports` / `main`.
 *   The single-surface response (plain root, or a single requested `package`) is **summary-first**:
 *   `view:"summary"` (default) returns an {@link ApiSurfaceSummary} — counts, a capped
 *   `{name,kind}` export sample, `byKind`, and the short `unreachableFromEntry` list;
 *   `view:"exports"` adds the full `publicExports`; `view:"full"` returns the complete
 *   {@link ApiSurface} with every path list.
 *   On a monorepo root without `package`: one compact summary per workspace package — per-package
 *   counts only (no path lists), each exported symbol reduced to `{ name, kind }`, and the
 *   `publicExports` sample capped at `maxExportsPerPackage` (default 10; `0` = counts only).
 * @param cache - Session state holding the cached graph(s) for `root`.
 * @param args - `root` selects the project; `entryPoints` overrides auto-detection; `package`
 *   scopes to one workspace package; `view` / `maxExports` shape the single-surface response;
 *   `maxExportsPerPackage` caps the per-package `publicExports` sample in the multi-package
 *   response (default 10, `0` = counts only).
 * @returns TextResponse: an {@link ApiSurfaceSummary} (or fuller, per `view`) for a plain root or
 *   a single requested package; otherwise `{ packages: [...compact per-package summaries],
 *   skipped, truncated }`.
 */
/** JVM (and Go, after language-aware detection) treat every source file as an entry point, so a
 *  surface can carry hundreds of them. Echo at most this many back, with the true `entryPointCount`
 *  alongside — an empty `unreachableFromEntry` next to a large count then reads as "every file is
 *  an entry", not "nothing is separate". */
const MAX_ENTRY_POINTS_ECHOED = 25;

function echoEntryPoints(eps: string[]): {
  entryPoints: string[];
  entryPointCount: number;
  entryPointsTruncated?: true;
} {
  if (eps.length <= MAX_ENTRY_POINTS_ECHOED) {
    return { entryPoints: eps, entryPointCount: eps.length };
  }
  return {
    entryPoints: eps.slice(0, MAX_ENTRY_POINTS_ECHOED),
    entryPointCount: eps.length,
    entryPointsTruncated: true,
  };
}

/**
 * Renders one full `ApiSurface` for a single-surface response (plain root or a single requested
 * `package`), honouring `view`. `"summary"` (default) is a token-bounded projection; `"exports"`
 * adds the full `publicExports`; `"full"` is the complete surface with every path list.
 */
function renderSurface(
  surface: ApiSurface,
  view: GetApiSurfaceArgs["view"],
  maxExports?: number,
): TextResponse {
  if (view === "full") {
    return text({ ...surface, ...echoEntryPoints(surface.entryPoints) });
  }
  const summary = summarizeApiSurface(surface, maxExports === undefined ? {} : { maxExports });
  if (view === "exports") {
    const { publicExportsTruncated: _drop, ...rest } = summary;
    return text({
      ...rest,
      publicExports: surface.publicExports,
      hint: `Pass view:"full" for the internalFiles / testFiles path lists.`,
    });
  }
  return text(summary);
}

export async function handleGetApiSurface(
  cache: SessionState,
  args: GetApiSurfaceArgs,
): Promise<TextResponse> {
  const { root, entryPoints, package: pkg, view = "summary", maxExports } = args;
  const maxExportsPerPackage = args.maxExportsPerPackage ?? 10;

  // Plain (non-monorepo) root.
  if (!cache.isWorkspaceRoot(root)) {
    const graph = await cache.ensureFresh(root);
    const eps = entryPoints?.length ? entryPoints : detectAllEntryPoints(graph, root);
    if (eps.length === 0) {
      throw new Error(
        "No entry points found. Pass entryPoints explicitly, or (JS) ensure package.json has a main/exports field.",
      );
    }
    return renderSurface(buildApiSurface(graph, eps), view, maxExports);
  }

  // Monorepo root: one surface per package. Entry points come from the WorkspaceGraph the
  // detectors already resolved per package (relative to each package's own root), or from an
  // explicit `entryPoints` arg — either way filtered to files actually present in that
  // package's graph, so a package that contributes none is skipped, never thrown on.
  const wg = await cache.ensureFreshWorkspace(root);
  const graphs = await cache.resolveGraphs(root, pkg); // validates `pkg`, restricts to own files

  const surfaceFor = (pkgName: string, graph: Graph): ApiSurface | null => {
    const candidates = entryPoints?.length
      ? entryPoints
      : (wg.packages.get(pkgName)?.pkg.entryPoints ?? []).map((ep) => path.relative(root, ep));
    const eps = candidates.filter((ep) => graph.nodes.has(ep));
    return eps.length ? buildApiSurface(graph, eps) : null;
  };

  // A single package was requested → return its surface (summary-first, `view`-controlled).
  if (graphs.length === 1) {
    const only = graphs[0];
    if (!only) throw new Error("get_api_surface: no graph resolved for this root.");
    const surface = surfaceFor(only.package, only.graph);
    if (!surface) {
      throw new Error(
        `No entry point for package "${only.package}" is present in the analyzed graph. Pass entryPoints explicitly.`,
      );
    }
    return renderSurface(surface, view, maxExports);
  }

  // Every package → capped per-package breakdown; packages with no entry point are listed in
  // `skipped`. Deliberately compact so a 30+-package monorepo stays well under an MCP token cap:
  // no per-package path lists (counts only), and each exported symbol is just `name` + `kind`
  // (call get_api_surface with `package` for one package's full surface). `maxExportsPerPackage:
  // 0` drops the `publicExports` sample entirely — a counts-only mode.
  interface PackageApiSummary {
    package: string;
    entryPointCount: number;
    publicExportCount: number;
    publicExports?: Array<{ name: string; kind: PublicExport["kind"] }>;
    internalFileCount: number;
    unreachableFromEntryCount: number;
    testFileCount: number;
  }
  const packages: PackageApiSummary[] = [];
  const skipped: Array<{ package: string; reason: string }> = [];
  let truncated = false;

  for (const { package: pkgName, graph } of graphs) {
    const surface = surfaceFor(pkgName, graph);
    if (!surface) {
      skipped.push({
        package: pkgName,
        reason: "no entry point resolvable from the WorkspaceGraph",
      });
      continue;
    }
    const summary: PackageApiSummary = {
      package: pkgName,
      entryPointCount: surface.entryPoints.length,
      publicExportCount: surface.publicExports.length,
      internalFileCount: surface.internalFiles.length,
      unreachableFromEntryCount: surface.unreachableFromEntry.length,
      testFileCount: surface.testFiles.length,
    };
    if (maxExportsPerPackage > 0) {
      summary.publicExports = surface.publicExports
        .slice(0, maxExportsPerPackage)
        .map((exp) => ({ name: exp.name, kind: exp.kind }));
      if (summary.publicExports.length < surface.publicExports.length) truncated = true;
    } else if (surface.publicExports.length > 0) {
      truncated = true;
    }
    packages.push(summary);
  }
  return text({ packages, skipped, truncated });
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
  const graphs = await cache.resolveGraphs(args.root, args.package);
  const perPackage = await Promise.all(
    graphs.map(({ graph }) => applyTags(graph, args.root, { dryRun: args.dryRun ?? false })),
  );
  const result = perPackage.reduce((acc, r) => ({
    updated: acc.updated + r.updated,
    unchanged: acc.unchanged + r.unchanged,
    errors: acc.errors + r.errors,
    files: [...acc.files, ...r.files],
  }));
  return text(result);
}
