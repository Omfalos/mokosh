/** Pure graph query/shaping functions shared by the MCP handlers and the CLI, so both surfaces return identical JSON shapes. */
import type { SerializedGraph } from "../types/graph";
import type { FileNode } from "../types/node";
import type { Graph } from "./model";
import { SymbolTraversalContext } from "./symbol-traversal";
import type { WorkspaceGraph } from "./workspace-model";

export interface PathWithSymbols {
  path: string;
  symbols?: string[];
}

/**
 * @description Outgoing traversal from `file` — all files it imports, up to `depth` hops.
 * @param graph - The graph to traverse.
 * @param file - Project-relative path of the starting node.
 * @param depth - Max traversal depth (default 1 = immediate imports only).
 * @returns Reachable imported paths, each with the symbols imported from it when known.
 */
export function getDependencies(graph: Graph, file: string, depth = 1): PathWithSymbols[] {
  const deps: PathWithSymbols[] = [];
  graph.traverse(
    file,
    (node, _depth, parentPath) => {
      if (node.path === file) return true;
      const edge = parentPath
        ? graph.nodes.get(parentPath)?.imports.find((importEdge) => importEdge.toPath === node.path)
        : undefined;
      deps.push({ path: node.path, ...(edge?.symbols ? { symbols: edge.symbols } : {}) });
      return true;
    },
    { direction: "outgoing", maxDepth: depth },
  );
  return deps;
}

/**
 * @description Incoming one-hop traversal — files that directly import `file`.
 * @param graph - The graph to traverse.
 * @param file - Project-relative path of the target node.
 * @returns Direct importers, each with the symbols they import from `file` when known.
 */
export function getDependents(graph: Graph, file: string): PathWithSymbols[] {
  const dependents: PathWithSymbols[] = [];
  graph.traverse(
    file,
    (node) => {
      if (node.path === file) return true;
      const edge = node.imports.find((importEdge) => importEdge.toPath === file);
      dependents.push({ path: node.path, ...(edge?.symbols ? { symbols: edge.symbols } : {}) });
      return true;
    },
    { direction: "incoming", maxDepth: 1 },
  );
  return dependents;
}

export interface GetAffectedOptions {
  testsOnly?: boolean | undefined;
  changedSymbols?: string[] | undefined;
}

/**
 * @description Full incoming traversal from `file` upward — every file transitively affected if `file` changes.
 * @param graph - The graph to traverse.
 * @param file - Project-relative path of the changed node.
 * @param options - `testsOnly` restricts results to test/spec files; `changedSymbols` restricts propagation to files that actually import those symbols.
 * @returns Project-relative paths of all transitively impacted files.
 */
export function getAffected(
  graph: Graph,
  file: string,
  options: GetAffectedOptions = {},
): string[] {
  const { testsOnly = false, changedSymbols } = options;
  const ctx = changedSymbols ? new SymbolTraversalContext(file, changedSymbols) : null;
  const affected: string[] = [];
  graph.traverse(
    file,
    (node, _depth, parentPath) => {
      if (node.path === file) return true;
      if (ctx && parentPath && !ctx.updateAffectedSymbols(node, parentPath)) return false;
      const isTest = node.category === "test" || node.tags.some((tag) => tag.name === "test");
      if (!testsOnly || isTest) affected.push(node.path);
      return true;
    },
    { direction: "incoming" },
  );
  return affected;
}

export interface CallerEntry {
  file: string;
  edges?: Array<{ from: string; to: string }>;
}

export interface GetCallersOptions {
  depth?: number | undefined;
  withEdgeDetail?: boolean | undefined;
}

/**
 * @description Incoming call-edge traversal — files whose exported functions call into `file`.
 *   More precise than `getAffected` because it follows runtime call edges rather than all import edges.
 * @param graph - The graph to traverse.
 * @param file - Project-relative path of the target node.
 * @param options - `depth` caps traversal hops (default 1); `withEdgeDetail` adds from/to function names per edge.
 * @returns Callers, each optionally including edge detail.
 */
export function getCallers(
  graph: Graph,
  file: string,
  options: GetCallersOptions = {},
): CallerEntry[] {
  const { depth = 1, withEdgeDetail = false } = options;
  const callers: CallerEntry[] = [];
  graph.traverseCalls(
    file,
    (node) => {
      if (node.path === file) return true;
      const entry: CallerEntry = { file: node.path };
      if (withEdgeDetail) {
        entry.edges = (node.callEdges ?? [])
          .filter((callEdge) => callEdge.toFile === file)
          .map((callEdge) => ({ from: callEdge.from, to: callEdge.to }));
      }
      callers.push(entry);
      return true;
    },
    { direction: "incoming", maxDepth: depth },
  );
  return callers;
}

export interface ComplexFunctionEntry {
  file: string;
  name: string;
  line: number;
  complexity: number;
  cognitiveComplexity: number;
}

export interface FindComplexFunctionsOptions {
  metric?: "cognitiveComplexity" | "complexity" | undefined;
  threshold?: number | undefined;
  limit?: number | undefined;
}

/**
 * @description Scans every file's per-function complexity breakdown and returns functions/methods
 *   at or above the given threshold, sorted worst-first. TypeScript/JavaScript only.
 * @param graph - The graph to scan.
 * @param options - `metric` picks which score to threshold/sort on (default `cognitiveComplexity`); `threshold` is the minimum score to include (default 10); `limit` caps the results (default 20).
 * @returns Matching functions, sorted worst-first.
 */
export function findComplexFunctions(
  graph: Graph,
  options: FindComplexFunctionsOptions = {},
): ComplexFunctionEntry[] {
  const { metric = "cognitiveComplexity", threshold = 10, limit = 20 } = options;
  return [...graph.nodes.values()]
    .flatMap((node) =>
      (node.functions ?? [])
        .filter((fn) => fn[metric] >= threshold)
        .map((fn) => ({
          file: node.path,
          name: fn.name,
          line: fn.line,
          complexity: fn.complexity,
          cognitiveComplexity: fn.cognitiveComplexity,
        })),
    )
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, limit);
}

export interface SlimNode {
  path: string;
  type: FileNode["type"];
  category: FileNode["category"];
  exports: string[];
  tags: string[];
  importsFiles: string[];
  description?: string;
  testedBy?: string[];
  coveragePct?: number;
  avgExportUsage?: number;
  maxExportUsage?: number;
}

export interface SlimSerializedGraph {
  nodes: SlimNode[];
  cycles: string[][] | undefined;
}

/**
 * @description Strips a serialized graph down to a compact response: export names, meaningful tags,
 *   and a flat importsFiles path list — no edge objects, no mtime/size.
 * @param filtered - A `SerializedGraph` (typically the output of `filterGraph`) to compact.
 * @returns The slim node list plus cycle info.
 */
export function slimSerialize(filtered: SerializedGraph): SlimSerializedGraph {
  const slimNodes = filtered.nodes.map((node) => ({
    path: node.path,
    type: node.type,
    category: node.category,
    exports: node.exports.map((exportedSym) => exportedSym.name),
    tags: node.tags
      .filter((tag) => tag.kind === "comment-marker" || tag.kind === "import")
      .map((tag) => tag.name),
    importsFiles: node.imports
      .filter((imp) => !imp.isExternal && imp.toPath)
      .map((imp) => imp.toPath as string),
    ...(node.description !== undefined && { description: node.description }),
    ...(node.testedBy !== undefined && { testedBy: node.testedBy }),
    ...(node.coveragePct !== undefined && { coveragePct: node.coveragePct }),
    ...(node.avgExportUsage !== undefined && { avgExportUsage: node.avgExportUsage }),
    ...(node.maxExportUsage !== undefined && { maxExportUsage: node.maxExportUsage }),
  }));
  return { nodes: slimNodes, cycles: filtered.cycles };
}

export interface WorkspacePackageSummary {
  name: string;
  relativeRoot: string;
  nodeCount: number;
  dependsOn: string[];
}

export interface WorkspacePackagesSummary {
  monorepoType: string;
  packageCount: number;
  packages: WorkspacePackageSummary[];
}

/**
 * @description Summarizes every package in a workspace graph: node counts and cross-package dependencies.
 * @param wg - The workspace graph to summarize.
 * @returns Monorepo type, package count, and per-package details.
 */
export function summarizeWorkspacePackages(wg: WorkspaceGraph): WorkspacePackagesSummary {
  const pkgDeps = wg.getPackageDependencies();
  const packages = Array.from(wg.packages.values()).map(({ graph, pkg }) => ({
    name: pkg.name,
    relativeRoot: pkg.relativeRoot,
    nodeCount: graph.nodes.size,
    dependsOn: pkgDeps.get(pkg.name) ?? [],
  }));
  return { monorepoType: wg.type, packageCount: packages.length, packages };
}

/**
 * @description Returns `true` if at least one node in the graph has coverage data loaded.
 * @param graph - The graph to check.
 * @returns Whether any node has a defined `coveragePct`.
 */
export function hasCoverageData(graph: Graph): boolean {
  return [...graph.nodes.values()].some((node) => node.coveragePct !== undefined);
}
