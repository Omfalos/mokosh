export { applyConfig, loadMokoshConfig, type MokoshConfig } from "./config";
export { loadCoverageMap } from "./coverage";
export * from "./git";
export * from "./graph";
export * from "./parser";
export { filterGraph, type NodeQuery, parseQuery } from "./query";
export * from "./tags";
export * from "./types";

import fs from "node:fs";
import path from "node:path";
import {
  DefaultResolver,
  detectMonorepo,
  type Graph,
  GraphBuilder,
  MermaidExporter,
  WorkspaceGraph,
} from "./graph";

export function toMermaid(graph: Graph): string {
  return MermaidExporter.toMermaid(graph);
}

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

export async function createWorkspaceGraph(
  rootDir: string,
  options: { packages?: string[]; silent?: boolean; gitStats?: boolean } = {},
): Promise<WorkspaceGraph> {
  const abs = path.resolve(rootDir);
  const layout = detectMonorepo(abs);

  const pkgs = options.packages
    ? layout.packages.filter(
        (p) => options.packages!.includes(p.name) || options.packages!.includes(p.relativeRoot),
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

export const DEFAULT_IGNORE_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "mokosh-cache",
  "coverage",
];

export const DEFAULT_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".coffee",
  ".ls",
  ".lua",
  ".py",
  ".feature",
];

export interface ScanOptions {
  /** Replaces the default ignore-dir list. Use `additionalIgnoreDirs` to extend instead. */
  ignoreDirs?: string[];
  /** Replaces the default extension list. Use `additionalExtensions` to extend instead. */
  extensions?: string[];
  /** Merged with `DEFAULT_IGNORE_DIRS` (additive). */
  additionalIgnoreDirs?: string[];
  /** Merged with `DEFAULT_EXTENSIONS` (additive). */
  additionalExtensions?: string[];
}

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
