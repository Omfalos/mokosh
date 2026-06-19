import path from "node:path";
import { DefaultGitProvider } from "../git";
import {
  applyConfig,
  buildApiSurface,
  buildFeatureGraph,
  buildResponsibilityGraph,
  buildTypeGraph,
  detectAllEntryPoints,
  detectFeatures,
  detectMonorepo,
  filterGraph,
  Graph,
  getAllProjectFiles,
  loadCoverageMap,
  loadMokoshConfig,
  MermaidExporter,
  parseQuery,
  proposeAffectedTests,
  proposeTags,
  queryCallGraph,
  queryChangeImpact,
  queryTypeGraph,
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
export type GetDependenciesArgs = { root: string; file: string; depth?: number };
export type GetDependentsArgs = { root: string; file: string };
export type GetAffectedArgs = { root: string; file: string; testsOnly?: boolean; cached?: boolean };
export type GetCallersArgs = {
  root: string;
  file: string;
  depth?: number;
  withEdgeDetail?: boolean;
};
export type FindUnusedArgs = { root: string; entryPoints: string[] };
export type FindUncoveredArgs = { root: string; coverageThreshold?: number };
export type ProposeTagsArgs = {
  root: string;
  changedFiles?: string[];
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

export type ToolArgs =
  | AnalyzeArgs
  | GetDependenciesArgs
  | GetDependentsArgs
  | GetAffectedArgs
  | GetCallersArgs
  | FindUnusedArgs
  | FindUncoveredArgs
  | ProposeTagsArgs
  | DetectFeaturesArgs
  | QueryArgs
  | ClearCacheArgs
  | GetTypeGraphArgs
  | GetModuleResponsibilityArgs
  | GetFeatureGraphArgs
  | GetCallGraphArgs
  | GetApiSurfaceArgs;

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
      const wg = await cache.getOrBuildWorkspace(root, { gitStats: config?.gitStats ?? false });
      const perPackage = Array.from(wg.packages.values()).map(({ graph, pkg }) => ({
        package: pkg.name,
        relativeRoot: pkg.relativeRoot,
        nodeCount: graph.nodes.size,
      }));
      return text({
        monorepoType: layout.type,
        packageCount: wg.packages.size,
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
  const serialized = graph.serialize();
  const categories = serialized.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.category] = (acc[n.category] ?? 0) + 1;
    return acc;
  }, {});
  const cycles = graph.findCycles();
  return text({ nodeCount: serialized.nodes.length, categories, cycles });
}

/**
 * @description Outgoing traversal from `file` — returns all files that `file` imports,
 *   up to `depth` hops (default 1 = immediate imports only). Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the starting node; `depth` caps traversal depth.
 * @returns TextResponse with `{ file, dependencies }` listing all reachable imported paths.
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
 * @description Incoming one-hop traversal — returns files that directly import `file`.
 *   For the full transitive upstream set use `handleGetAffected` instead. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the node whose direct importers to find.
 * @returns TextResponse with `{ file, dependents }` listing files that import `file` directly.
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
 * @description Full incoming traversal from `file` upward — returns every file whose behaviour
 *   could change if `file` changes (blast-radius analysis). Set `cached=true` to use a pre-computed
 *   O(1) impact cache instead of graph traversal — faster on repeated calls for the same root.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the changed node; `testsOnly` restricts results to test/spec files; `cached` switches to the impact cache.
 * @returns TextResponse with `{ file, affected, count }` listing all transitively impacted files.
 */
export function handleGetAffected(cache: SessionState, args: GetAffectedArgs) {
  const { root, file, testsOnly = false, cached = false } = args;
  if (cached) {
    const impactCache = cache.getOrBuildChangeImpact(root);
    const allAffected = queryChangeImpact(impactCache, file);
    const affected = testsOnly
      ? allAffected.filter((p) => cache.require(root).nodes.get(p)?.category === "test")
      : allAffected;
    return text({ file, affected, count: affected.length });
  }
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
 * @description Incoming call-edge traversal — returns files whose exported functions call
 *   into `file`. More precise than `handleGetAffected` because it follows runtime call edges
 *   rather than all import edges.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root`/`file` identify the target; `depth` caps hops; `withEdgeDetail` adds from/to function names per edge.
 * @returns TextResponse with `{ file, callers, count }` where each caller optionally includes edge detail.
 */
export function handleGetCallers(cache: SessionState, args: GetCallersArgs) {
  const { root, file, depth = 1, withEdgeDetail = false } = args;
  const graph = cache.require(root);
  const callers: Array<{ file: string; edges?: Array<{ from: string; to: string }> }> = [];
  graph.traverseCalls(
    file,
    (node) => {
      if (node.path === file) return true;
      const entry: { file: string; edges?: Array<{ from: string; to: string }> } = {
        file: node.path,
      };
      if (withEdgeDetail) {
        entry.edges = (node.callEdges ?? [])
          .filter((e) => e.toFile === file)
          .map((e) => ({ from: e.from, to: e.to }));
      }
      callers.push(entry);
      return true;
    },
    { direction: "incoming", maxDepth: depth },
  );
  return text({ file, callers, count: callers.length });
}

/**
 * @description Scans the entire project directory and compares against the graph reachable
 *   from `entryPoints`, returning files that exist on disk but are never imported — candidates for deletion.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root` is the project directory; `entryPoints` seeds the reachability walk.
 * @returns TextResponse with `{ unusedFiles, count }` listing files unreachable from any entry point.
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
 * @description Returns non-test files whose line coverage is below the configured threshold.
 *   Threshold priority: `args.coverageThreshold` → `config.coverageThreshold` → 80.
 *   Requires a prior `analyze` call with `coverageReportPath` set in `mokosh.config`.
 *   Returns an error when no coverage data was loaded rather than treating all files as 0%.
 * @param cache - Session state holding the cached graph and config.
 * @param args - `root` selects the graph; `coverageThreshold` overrides the config default.
 * @returns TextResponse with `{ threshold, uncovered, count }` where each entry includes file path and coverage percentage.
 */
export function handleFindUncovered(cache: SessionState, args: FindUncoveredArgs) {
  const { root, coverageThreshold } = args;
  const graph = cache.require(root);
  const config = cache.getConfig(root);
  const threshold = coverageThreshold ?? config?.coverageThreshold ?? 80;

  const hasCoverageData = [...graph.nodes.values()].some((n) => n.coveragePct !== undefined);
  if (!hasCoverageData) {
    return text({
      error:
        "No coverage data available. Set coverageReportPath in mokosh.config and call analyze again.",
    });
  }

  const uncovered = [...graph.nodes.values()]
    .filter((n) => n.category !== "test" && n.category !== "config")
    .filter((n) => n.coveragePct !== undefined && n.coveragePct < threshold)
    .map((n) => ({ file: n.path, coveragePct: n.coveragePct as number }));
  return text({ threshold, uncovered, count: uncovered.length });
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
export function handleProposeTags(cache: SessionState, args: ProposeTagsArgs) {
  const { root, changedFiles, featureThreshold, format = "tags" } = args;
  const graph = cache.require(root);
  const files =
    changedFiles ??
    new DefaultGitProvider()
      .getChangedFiles()
      .map((f) => path.relative(root, path.resolve(root, f)));
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
    : cache.require(root);
  const filtered = filterGraph(graph.serialize(), parseQuery(filter));
  if (mermaid) {
    return text(MermaidExporter.serialize(Graph.deserialize(filtered)));
  }
  if (slim) {
    const slimNodes = filtered.nodes.map((n) => ({
      path: n.path,
      type: n.type,
      category: n.category,
      exports: n.exports.map((e) => e.name),
      tags: n.tags
        .filter((t) => t.kind === "comment-marker" || t.kind === "import")
        .map((t) => t.name),
      importsFiles: n.imports
        .filter((imp) => !imp.isExternal && imp.toPath)
        .map((imp) => imp.toPath as string),
      ...(n.description !== undefined && { description: n.description }),
      ...(n.testedBy !== undefined && { testedBy: n.testedBy }),
      ...(n.coveragePct !== undefined && { coveragePct: n.coveragePct }),
      ...(n.avgExportUsage !== undefined && { avgExportUsage: n.avgExportUsage }),
      ...(n.maxExportUsage !== undefined && { maxExportUsage: n.maxExportUsage }),
    }));
    return text({ nodes: slimNodes, cycles: filtered.cycles });
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
export function handleGetWorkspacePackages(
  cache: SessionState,
  args: GetWorkspacePackagesArgs,
): TextResponse {
  const { root } = args;
  const wg = cache.requireWorkspace(root);
  const pkgDeps = wg.getPackageDependencies();
  const packages = Array.from(wg.packages.values()).map(({ graph, pkg }) => ({
    name: pkg.name,
    relativeRoot: pkg.relativeRoot,
    nodeCount: graph.nodes.size,
    dependsOn: pkgDeps.get(pkg.name) ?? [],
  }));
  return text({ monorepoType: wg.type, packageCount: packages.length, packages });
}

/**
 * @description Cross-package blast-radius analysis — returns every file that could be affected
 *   if `file` changes, annotated with the package it belongs to. Requires a prior `analyze` call with no entry points.
 * @param cache - Session state holding the cached WorkspaceGraph.
 * @param args - `root` identifies the monorepo; `file` is the changed file (relative to root).
 * @returns TextResponse with `{ file, affected, count }` where each entry includes its package name.
 */
export function handleGetWorkspaceAffected(
  cache: SessionState,
  args: GetWorkspaceAffectedArgs,
): TextResponse {
  const { root, file } = args;
  const wg = cache.requireWorkspace(root);
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
export function handleGetTypeGraph(cache: SessionState, args: GetTypeGraphArgs): TextResponse {
  const { root, type } = args;
  const graph = cache.require(root);
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
export function handleGetModuleResponsibility(
  cache: SessionState,
  args: GetModuleResponsibilityArgs,
): TextResponse {
  const { root, paths, minOutDegree } = args;
  const graph = cache.require(root);
  const respGraph = buildResponsibilityGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );
  if (paths?.length) {
    const modules = paths.map((p) => respGraph.get(p)).filter(Boolean);
    return text({ count: modules.length, modules });
  }
  const modules = Array.from(respGraph.values());
  return text({ count: modules.length, modules });
}

/**
 * @description Groups files into feature domains under their respective hub files (high-import
 *   orchestrators). Each file is assigned to the most specific hub that can transitively reach it.
 *   Returns up to 85–95% fewer tokens than a full graph query for domain-based questions.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `minOutDegree` sets the minimum internal imports to qualify as a hub.
 * @returns TextResponse with `{ features, unassigned }` where `features` is a plain object keyed by feature name.
 */
export function handleGetFeatureGraph(
  cache: SessionState,
  args: GetFeatureGraphArgs,
): TextResponse {
  const { root, minOutDegree } = args;
  const graph = cache.require(root);
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
export function handleGetCallGraph(cache: SessionState, args: GetCallGraphArgs): TextResponse {
  const { root, function: functionName } = args;
  const graph = cache.require(root);
  return text(queryCallGraph(graph, functionName));
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
export function handleGetApiSurface(cache: SessionState, args: GetApiSurfaceArgs): TextResponse {
  const { root, entryPoints } = args;
  const graph = cache.require(root);
  const eps = entryPoints?.length ? entryPoints : detectAllEntryPoints(graph, root);
  if (eps.length === 0) {
    throw new Error(
      "No entry points found. Pass entryPoints explicitly or ensure package.json has a main/exports field.",
    );
  }
  return text(buildApiSurface(graph, eps));
}
