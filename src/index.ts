/** Public library API: createImportMap, createWorkspaceGraph, and getAllProjectFiles. */

// Config
export { applyConfig, loadMokoshConfig, type MokoshConfig } from "./config";

// Constants
export { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS, type ScanOptions } from "./const";

// Coverage
export { loadCoverageMap } from "./coverage";

// Exporters
export { type GraphExporter, MermaidExporter, toMermaid } from "./exporters";
// Graph analysis utilities
export {
  type ApiSurface,
  buildApiSurface,
  detectAllEntryPoints,
  detectEntryPoint,
  type ExportKind,
  type PublicExport,
} from "./graph/api-surface";
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
// Core graph classes
export { Graph } from "./graph/model";
export { buildResponsibilityGraph } from "./graph/responsibility";
export type {
  ModuleResponsibility,
  ModuleRole,
  ResponsibilityGraph,
} from "./graph/responsibility/types";
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
export { detectMonorepo } from "./graph/workspace";
export { type MonorepoDetector, registerMonorepoDetector } from "./graph/workspace/registry";
export type { MonorepoLayout, WorkspacePackage } from "./graph/workspace/types";
export { type SerializedWorkspaceGraph, WorkspaceGraph } from "./graph/workspace-model";
export {
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
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

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS, type ScanOptions } from "./const";
import { DefaultResolver, detectMonorepo, type Graph, GraphBuilder, WorkspaceGraph } from "./graph";

/**
 * @description Builds a dependency graph from the given entry points, optionally reusing a
 *   previously built graph for incremental updates.
 * @param rootDir - Absolute or relative path to the project root; resolved internally.
 * @param entryPoints - File paths (relative to `rootDir`) that seed the graph walk.
 * @param previousGraph - An earlier graph to diff against for incremental builds; pass `null` for a full build.
 * @param options - `silent` suppresses progress output; `gitStats` attaches git churn data; `coverageMap` maps file paths to line-coverage percentages.
 * @returns The fully-built Graph with all reachable nodes and import edges populated.
 */
export async function createImportMap(
  rootDir: string,
  entryPoints: string[],
  previousGraph: Graph | null = null,
  options: { silent?: boolean; gitStats?: boolean; coverageMap?: Map<string, number> } = {},
): Promise<Graph> {
  const progressCallback = options.silent
    ? undefined
    : (count: number) => {
        process.stderr.write(`Processed ${count} files...\r`);
      };
  const builder = new GraphBuilder(
    path.resolve(rootDir),
    previousGraph,
    undefined,
    progressCallback,
    options.gitStats ?? false,
    options.coverageMap ?? new Map(),
  );
  return await builder.build(entryPoints);
}

/**
 * @description Auto-detects the monorepo layout under `rootDir` and builds a per-package
 *   dependency graph, stitching them together into a single WorkspaceGraph.
 * @param rootDir - Absolute path to the monorepo root.
 * @param options - `packages` filters to a named subset of packages; `silent` suppresses progress; `gitStats` attaches git churn data per file.
 * @returns A WorkspaceGraph where each package has its own Graph and cross-package edges are resolved.
 */
export async function createWorkspaceGraph(
  rootDir: string,
  options: { packages?: string[]; silent?: boolean; gitStats?: boolean } = {},
): Promise<WorkspaceGraph> {
  const abs = path.resolve(rootDir);
  const layout = detectMonorepo(abs);

  const pkgs = options.packages
    ? layout.packages.filter(
        (pkg) =>
          options.packages?.includes(pkg.name) || options.packages?.includes(pkg.relativeRoot),
      )
    : layout.packages;

  const workspaceMap = new Map(layout.packages.map((pkg) => [pkg.name, pkg.root]));
  const wg = new WorkspaceGraph(abs, layout.type);

  for (const pkg of pkgs) {
    const progressCallback = options.silent
      ? undefined
      : (count: number) => {
          process.stderr.write(`[${pkg.name}] Processed ${count} files...\r`);
        };
    const builder = new GraphBuilder(
      abs,
      null,
      new DefaultResolver(abs, { workspaceMap, tsconfigSearchPaths: [pkg.root, abs] }),
      progressCallback,
      options.gitStats ?? false,
    );
    const graph = await builder.build(pkg.entryPoints);
    wg.addPackage(pkg, graph);
  }

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
