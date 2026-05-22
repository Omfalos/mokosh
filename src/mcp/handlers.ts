import path from "node:path";
import {
  applyConfig,
  detectFeatures,
  detectMonorepo,
  filterGraph,
  Graph,
  getAllProjectFiles,
  getGitDiffFiles,
  loadCoverageMap,
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
export type GetWorkspacePackagesArgs = { root: string };
export type GetWorkspaceAffectedArgs = { root: string; file: string };
export type GetDependenciesArgs = { root: string; file: string; depth?: number };
export type GetDependentsArgs = { root: string; file: string };
export type GetAffectedArgs = { root: string; file: string; testsOnly?: boolean };
export type GetCallersArgs = {
  root: string;
  file: string;
  depth?: number;
  withEdgeDetail?: boolean;
};
export type FindUnusedArgs = { root: string; entryPoints: string[] };
export type FindUncoveredArgs = { root: string; coverageThreshold?: number };
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
export type QueryArgs = {
  root: string;
  entryPoints?: string[];
  filter: string;
  mermaid?: boolean;
  slim?: boolean;
};

export type ToolArgs =
  | AnalyzeArgs
  | GetDependenciesArgs
  | GetDependentsArgs
  | GetAffectedArgs
  | GetCallersArgs
  | FindUnusedArgs
  | FindUncoveredArgs
  | ProposeTagsArgs
  | ProposeAffectedTestsArgs
  | DetectFeaturesArgs
  | QueryArgs;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Builds (or incrementally refreshes) the dependency graph and caches it for
 * the session. When `entryPoints` is empty, auto-detects whether `root` is a
 * monorepo and builds a per-package workspace graph if so.
 * Returns a lightweight summary — callers that need the full graph
 * should call `get_dependencies` or `query` afterwards.
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
 * @description Incoming call-edge traversal — returns files whose exported functions call
 *   into `file`. More precise than `get_affected` because it follows actual runtime call
 *   edges rather than all import edges.
 * @param cache - Session state holding the cached graph.
 * @param args - Tool arguments; `withEdgeDetail` includes from/to function names per edge.
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
 * @description Returns non-test files whose line coverage is below the configured threshold.
 *   The threshold is resolved in priority order: `args.coverageThreshold` → `config.coverageThreshold` → 80.
 *   Requires a prior `analyze` call with `coverageReportPath` set in `mokosh.config`.
 * @param cache - Session state holding the cached graph and config.
 * @param args - Tool arguments; `coverageThreshold` overrides the config default.
 */
export function handleFindUncovered(cache: SessionState, args: FindUncoveredArgs) {
  const { root, coverageThreshold } = args;
  const graph = cache.require(root);
  const config = cache.getConfig(root);
  const threshold = coverageThreshold ?? config?.coverageThreshold ?? 80;
  const uncovered = [...graph.nodes.values()]
    .filter((n) => n.category !== "test" && n.category !== "config")
    .filter((n) => (n.coveragePct ?? 0) < threshold)
    .map((n) => ({ file: n.path, coveragePct: n.coveragePct ?? null }));
  return text({ threshold, uncovered, count: uncovered.length });
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
 * string instead. Slim mode (default) strips edge objects, mtime/size, and
 * internal tags while keeping a flat `importsFiles` path list — pass
 * `slim: false` only when full edge metadata is needed.
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
    return text(MermaidExporter.toMermaid(Graph.deserialize(filtered)));
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
 * @description Lists all workspace packages detected in a monorepo root.
 *   Requires a prior `analyze` call with no entry points (monorepo auto-detection).
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
 * @description Cross-package blast-radius analysis. Returns every file that could be
 *   affected if `file` changes, annotated with the package it belongs to.
 *   Requires a prior `analyze` call with no entry points (monorepo auto-detection).
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
