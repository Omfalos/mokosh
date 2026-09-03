/** Public library API: createImportMap, createWorkspaceGraph, and getAllProjectFiles. */

// Config
export { applyConfig, configToGraphOptions, loadMokoshConfig, type MokoshConfig } from "./config";

// Constants
export {
  DEFAULT_BRANCH_GRAPH_CACHE_DIR,
  DEFAULT_CACHE_DIR,
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_EXTENSIONS,
  DEFAULT_GRAPH_CACHE_FILE,
  DEFAULT_IGNORE_DIRS,
  DEFAULT_WORKSPACE_GRAPH_CACHE_FILE,
  type ScanOptions,
} from "./const";

// Coverage
export { loadCoverageMap } from "./coverage";

// Exporters
export { type GraphExporter, MermaidExporter, toMermaid } from "./exporters";
export { type CycleEdgeKind, type FindCyclesOptions, GraphAnalyzer } from "./graph/analyzer";
// Graph analysis utilities
export {
  type ApiSurface,
  buildApiSurface,
  detectAllEntryPoints,
  detectEntryPoint,
  type ExportKind,
  type PublicExport,
} from "./graph/api-surface";
export type { ParallelParsingOption } from "./graph/builder";
export { queryCallGraph } from "./graph/call-graph";
export type {
  CalleeEntry,
  CallerEntry,
  FunctionCallInfo,
} from "./graph/call-graph/types";
export {
  buildChangeImpactCache,
  type ChangeImpactCache,
  computeGraphHash,
  isChangeImpactCacheValid,
  loadChangeImpactCache,
  queryChangeImpact,
  saveChangeImpactCache,
} from "./graph/change-impact-cache";
export {
  type BranchComparison,
  type BranchComparisonSummary,
  type BuildGraphAtRefOptions,
  buildGraphAtRef,
  type CompareBranchesOptions,
  type ComplexityDelta,
  type CoverageDelta,
  compareBranches,
  type DocDriftDelta,
  type DuplicationDelta,
  type FileDiff,
  type StaleReference,
  type SummarizeOptions,
  summarizeBranchComparison,
} from "./graph/compare";
export {
  type CachedFileTokens,
  type DuplicateFamily,
  type DuplicateGroup,
  type DuplicateOccurrence,
  type DuplicateSignal,
  type DuplicationTokenCache,
  type FindDuplicatesOptions,
  type FindDuplicatesResult,
  findDuplicates,
  hasGeneratedMarker,
  isGeneratedPath,
  loadTokenCacheFromDisk,
  saveTokenCacheToDisk,
} from "./graph/duplication";
export {
  detectFeatures,
  type FeatureDetectionOptions,
  type FeatureInfo,
} from "./graph/features";
export {
  buildFeatureGraph,
  type FeatureDomain,
  type FeatureGraph,
  type FeatureGraphOptions,
} from "./graph/features/feature-graph";
export {
  CALL_EDGE_TYPES,
  EXPORT_TRACKING_TYPES,
  getLanguageCoverage,
  IMPORT_SYMBOL_TYPES,
  type LanguageCoverage,
} from "./graph/language-support";
// Core graph classes
export { Graph } from "./graph/model";
export {
  type CallerEntry as GraphCallerEntry,
  type ComplexFunctionEntry,
  type FindComplexFunctionsOptions,
  type FindRiskHotspotsOptions,
  findComplexFunctions,
  findRiskHotspots,
  type GetAffectedOptions,
  type GetCallersOptions,
  getAffected,
  getCallers,
  getDependencies,
  getDependents,
  getNodeMeta,
  hasChurnData,
  hasCoverageData,
  type NodeMeta,
  type PathWithSymbols,
  type RiskHotspotEntry,
  type RiskHotspotsResult,
  type SlimNode,
  type SlimSerializedGraph,
  slimSerialize,
  summarizeWorkspacePackages,
  type WorkspacePackageSummary,
  type WorkspacePackagesSummary,
} from "./graph/queries";
export { buildResponsibilityGraph } from "./graph/responsibility";
export type {
  ModuleResponsibility,
  ModuleRole,
  ResponsibilityGraph,
} from "./graph/responsibility/types";
export {
  findSymbol,
  type SymbolCaller,
  type SymbolImporter,
  type SymbolMatch,
  type SymbolPrecision,
} from "./graph/symbol";
export { SymbolTraversalContext } from "./graph/symbol-traversal";
export {
  buildTypeGraph,
  queryTypeGraph,
  type TypeEdge,
  type TypeGraph,
  type TypeKind,
  type TypeNode,
  type TypeQueryResult,
} from "./graph/type-graph";
// Monorepo detection + extension point
export {
  detectMonorepo,
  summarizeWorkspaceLayout,
  type WorkspaceLayoutPackageSummary,
  type WorkspaceLayoutSummary,
} from "./graph/workspace";
export { type MonorepoDetector, registerMonorepoDetector } from "./graph/workspace/registry";
export type { MonorepoLayout, WorkspacePackage } from "./graph/workspace/types";
export { type SerializedWorkspaceGraph, WorkspaceGraph } from "./graph/workspace-model";
export {
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
  resetClassifyRegistries,
} from "./parser/classify";
// Parser extension points
export { registerParser } from "./parser/registry";
// Query
export { filterGraph, type NodeQuery, parseQuery } from "./query";
// Tags
export {
  type ApplyTagsFileResult,
  type ApplyTagsResult,
  applyTags,
  type ProposeTagsOptions,
  proposeAffectedTests,
  proposeTags,
  type TestNodeIdentifier,
} from "./tags";
export type {
  DependencyGraph,
  SerializedGraph,
  TraversalOptions,
  TraversalVisitor,
} from "./types/graph";
// Core data types
export type {
  CallEdge,
  ExportedSymbol,
  FileNode,
  ImportEdge,
  StructuredTag,
} from "./types/node";
export type { FileType, ImportType, NodeCategory, TagKind } from "./types/parse";

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS, type ScanOptions } from "./const";
import {
  DefaultResolver,
  detectMonorepo,
  type Graph,
  GraphBuilder,
  type MonorepoLayout,
  type ParallelParsingOption,
  WorkspaceGraph,
  type WorkspacePackage,
} from "./graph";
import { defaultLangResolvers, JvmLangResolver } from "./graph/lang-resolvers/index";

/**
 * @description Builds a dependency graph from the given entry points, optionally reusing a
 *   previously built graph for incremental updates.
 * @param rootDir - Absolute or relative path to the project root; resolved internally.
 * @param entryPoints - File paths (relative to `rootDir`) that seed the graph walk.
 * @param previousGraph - An earlier graph to diff against for incremental builds; pass `null` for a full build.
 * @param options - `silent` suppresses progress output; `gitStats` attaches git churn data; `coverageMap` maps file paths to line-coverage percentages; `parallelParsing` controls worker-pool offloading of file parsing (see {@link ParallelParsingOption}); `pathAliases` overrides/extends tsconfig path-alias resolution (see `MokoshConfig.pathAliases`); `additionalIgnoreDirs` skips extra directory names during test/doc discovery (see `MokoshConfig.ignoreDirs`).
 * @returns The fully-built Graph with all reachable nodes and import edges populated.
 */
export async function createImportMap(
  rootDir: string,
  entryPoints: string[],
  previousGraph: Graph | null = null,
  options: {
    silent?: boolean;
    gitStats?: boolean;
    coverageMap?: Map<string, number>;
    parallelParsing?: ParallelParsingOption | undefined;
    pathAliases?: Record<string, string[]> | undefined;
    additionalIgnoreDirs?: string[] | undefined;
    docFiles?: string[] | null | undefined;
  } = {},
): Promise<Graph> {
  const progressCallback = options.silent
    ? undefined
    : (count: number) => {
        process.stderr.write(`Processed ${count} files...\r`);
      };
  const abs = path.resolve(rootDir);
  const builder = new GraphBuilder(
    abs,
    previousGraph,
    options.pathAliases
      ? new DefaultResolver(abs, { pathAliases: options.pathAliases })
      : undefined,
    progressCallback,
    options.gitStats ?? false,
    options.coverageMap ?? new Map(),
    options.parallelParsing ?? true,
    options.additionalIgnoreDirs ?? [],
    options.docFiles ?? null,
  );
  return await builder.build(entryPoints);
}

/**
 * @description Resolves how many package graphs `createWorkspaceGraph` builds in parallel:
 *   `MOKOSH_WORKSPACE_CONCURRENCY` if set to a positive integer, otherwise the CPU count,
 *   clamped to `[1, packageCount]`. Set the env var to `1` to force sequential builds.
 * @param packageCount - Number of packages that will be built.
 * @returns The concurrency limit (always >= 1).
 */
function resolveWorkspaceConcurrency(packageCount: number): number {
  const fromEnv = Number.parseInt(process.env.MOKOSH_WORKSPACE_CONCURRENCY ?? "", 10);
  const desired = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : os.cpus().length || 1;
  return Math.max(1, Math.min(desired, Math.max(1, packageCount)));
}

/**
 * @description Walks the monorepo's `.md`/`.mdx` tree once and assigns each doc to the package
 *   whose root directory most specifically contains it. Docs that sit outside every package
 *   (e.g. a top-level `README.md`) are dropped — they belong to no package graph. Replaces the
 *   per-package whole-monorepo doc walk that `GraphBuilder.processDocFiles` would otherwise run
 *   N times.
 * @param monorepoRoot - Absolute monorepo root.
 * @param pkgs - The packages being built.
 * @returns Map from package name to the absolute doc paths it owns.
 */
function assignDocsToPackages(
  monorepoRoot: string,
  pkgs: WorkspacePackage[],
  projectFiles: string[],
): Map<string, string[]> {
  const byPackage = new Map<string, string[]>(pkgs.map((pkg) => [pkg.name, []]));
  // Longest root first so a nested package claims its docs before an ancestor package.
  const mostSpecificFirst = [...pkgs].sort((a, b) => b.root.length - a.root.length);
  for (const rel of projectFiles) {
    if (!rel.endsWith(".md") && !rel.endsWith(".mdx")) continue;
    const absDoc = path.join(monorepoRoot, rel);
    const owner = mostSpecificFirst.find(
      (pkg) => absDoc === pkg.root || absDoc.startsWith(`${pkg.root}${path.sep}`),
    );
    if (owner) byPackage.get(owner.name)?.push(absDoc);
  }
  return byPackage;
}

/**
 * @description Computes a digest of every source file under `rootDir` (path + mtime + size),
 *   used to decide whether a disk-persisted workspace graph is still valid. Changing, adding, or
 *   removing any file changes the digest.
 * @param rootDir - Absolute monorepo root.
 * @returns A hex sha-256 digest, and the relative file list it was computed from (reused by the
 *   caller so the directory tree is walked only once).
 */
export function computeWorkspaceSourceDigest(rootDir: string): {
  digest: string;
  files: string[];
} {
  const files = getAllProjectFiles(rootDir);
  const hash = crypto.createHash("sha256");
  for (const rel of [...files].sort()) {
    let line = `${rel}\0?\0?`;
    try {
      const stat = fs.statSync(path.join(rootDir, rel));
      line = `${rel}\0${stat.mtimeMs}\0${stat.size}`;
    } catch {
      // Unreadable/racing file — fold a stable placeholder in rather than throwing.
    }
    hash.update(`${line}\n`);
  }
  return { digest: hash.digest("hex"), files };
}

/**
 * @description Auto-detects the monorepo layout under `rootDir` and builds a per-package
 *   dependency graph, stitching them together into a single WorkspaceGraph.
 * @param rootDir - Absolute path to the monorepo root.
 * @param options - `packages` filters to a named subset of packages; `silent` suppresses progress; `gitStats` attaches git churn data per file; `parallelParsing` controls worker-pool offloading of file parsing per package (see {@link ParallelParsingOption}); `pathAliases` overrides/extends tsconfig path-alias resolution for every package (see `MokoshConfig.pathAliases`); `layout` supplies a pre-computed `detectMonorepo` result so detection is not repeated by callers that already ran it.
 * @returns A WorkspaceGraph where each package has its own Graph and cross-package edges are resolved.
 */
export async function createWorkspaceGraph(
  rootDir: string,
  options: {
    packages?: string[] | undefined;
    silent?: boolean;
    gitStats?: boolean;
    parallelParsing?: ParallelParsingOption | undefined;
    pathAliases?: Record<string, string[]> | undefined;
    additionalIgnoreDirs?: string[] | undefined;
    layout?: MonorepoLayout | undefined;
    /** Pre-computed `getAllProjectFiles(rootDir)` result, so the caller's digest walk isn't repeated. */
    projectFiles?: string[] | undefined;
    /** A previously built workspace graph; each package reuses its prior graph as an incremental
     *  base so unchanged files are not re-parsed (mtime+size match). */
    previousWorkspace?: WorkspaceGraph | undefined;
  } = {},
): Promise<WorkspaceGraph> {
  const abs = path.resolve(rootDir);
  const layout = options.layout ?? detectMonorepo(abs);
  const projectFiles = options.projectFiles ?? getAllProjectFiles(abs);
  const additionalIgnoreDirs = options.additionalIgnoreDirs ?? [];

  const pkgs = options.packages
    ? layout.packages.filter(
        (pkg) =>
          options.packages?.includes(pkg.name) || options.packages?.includes(pkg.relativeRoot),
      )
    : layout.packages;

  const workspaceMap = new Map(layout.packages.map((pkg) => [pkg.name, pkg.root]));
  const wg = new WorkspaceGraph(abs, layout.type);

  // One JVM resolver for the whole workspace: its package-declaration index is keyed by the
  // (shared) monorepo root and built lazily on first use, so every package build after the
  // first reuses it instead of re-scanning every .java/.kt/.scala file in the repo.
  const sharedJvmResolver = new JvmLangResolver(additionalIgnoreDirs);

  // Walk the monorepo doc tree once here and hand each package its own slice, instead of every
  // package's GraphBuilder re-walking the whole monorepo for `.md`/`.mdx` (see known_issues/01, 1D).
  const docsByPackage = assignDocsToPackages(abs, pkgs, projectFiles);

  // Build packages with bounded concurrency. When more than one runs at a time, parse
  // in-process per package so several builds don't each spin up a piscina pool and
  // oversubscribe the CPU (see docs/known_issues/01, fix 1C).
  const concurrency = resolveWorkspaceConcurrency(pkgs.length);
  const perPackageParallelParsing = concurrency > 1 ? false : (options.parallelParsing ?? true);
  const builtGraphs: Array<Graph | undefined> = new Array(pkgs.length);
  let nextIndex = 0;

  const runOne = async (): Promise<void> => {
    for (let index = nextIndex++; index < pkgs.length; index = nextIndex++) {
      const pkg = pkgs[index] as WorkspacePackage;
      const progressCallback = options.silent
        ? undefined
        : (count: number) => {
            process.stderr.write(`[${pkg.name}] Processed ${count} files...\r`);
          };
      const builder = new GraphBuilder(
        abs,
        options.previousWorkspace?.packages.get(pkg.name)?.graph ?? null,
        new DefaultResolver(abs, {
          workspaceMap,
          tsconfigSearchPaths: [pkg.root, abs],
          pathAliases: options.pathAliases,
          langResolvers: defaultLangResolvers({ jvm: sharedJvmResolver }),
        }),
        progressCallback,
        options.gitStats ?? false,
        new Map(),
        perPackageParallelParsing,
        additionalIgnoreDirs,
        docsByPackage.get(pkg.name) ?? [],
      );
      builtGraphs[index] = await builder.build(pkg.entryPoints);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runOne));

  // Register in the original package order so the workspace graph is deterministic.
  pkgs.forEach((pkg, index) => {
    wg.addPackage(pkg, builtGraphs[index] as Graph);
  });

  wg.annotateCrossPackageEdges();
  return wg;
}

/**
 * @description Recursively walks `rootDir` and returns paths of every file whose extension
 *   is in the allowed set, skipping ignored directories. Silently skips unreadable entries.
 * @param rootDir - Root directory to scan; returned paths are relative to this.
 * @param options - Override or extend the default ignore-dir and extension lists via ScanOptions.
 * @returns Relative file paths for all matching source files found under `rootDir`.
 */
export function getAllProjectFiles(rootDir: string, options: ScanOptions = {}): string[] {
  const files: string[] = [];
  const ignoreDirs = new Set([
    ...(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS),
    ...(options.additionalIgnoreDirs ?? []),
  ]);
  const extensions = new Set([
    ...(options.extensions ?? DEFAULT_EXTENSIONS),
    ...(options.additionalExtensions ?? []),
  ]);

  /**
   * @description Recursively visits `dir`, pushing matching file paths into the outer `files` array.
   * @param dir - Absolute path of the directory to scan in this recursion step.
   */
  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name)) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          if (extensions.has(path.extname(entry.name).toLowerCase())) {
            files.push(path.relative(rootDir, fullPath));
          }
        }
      }
    } catch (_e) {
      // Permission issues or broken symlinks
    }
  }

  walk(rootDir);
  return files;
}
