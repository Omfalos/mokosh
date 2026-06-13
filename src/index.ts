/** Public library API: createImportMap, createWorkspaceGraph, and getAllProjectFiles. */
export { applyConfig, loadMokoshConfig, type MokoshConfig } from "./config";
export * from "./const";
export { loadCoverageMap } from "./coverage";
export * from "./exporters";
export * from "./git";
export * from "./graph";
export * from "./parser";
export { filterGraph, type NodeQuery, parseQuery } from "./query";
export * from "./tags";
export * from "./types";

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
        (p) => options.packages?.includes(p.name) || options.packages?.includes(p.relativeRoot),
      )
    : layout.packages;

  const workspaceMap = new Map(layout.packages.map((p) => [p.name, p.root]));
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
