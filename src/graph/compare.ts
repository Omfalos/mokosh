/** Compares two commits' dependency graphs for code review: file diff, stale post-rename usages, and deltas across the quality tools (duplication, complexity, doc drift, coverage/risk). */
import path from "node:path";
import { DEFAULT_DUPLICATION_TOKEN_CACHE_FILE } from "../const";
import { branchGraphCacheDir, loadBranchGraph, saveBranchGraph } from "./branch-graph-cache";
import type { ParallelParsingOption } from "./builder";
import { GraphBuilder } from "./builder";
import type { DuplicateGroup } from "./duplication";
import { findDuplicates, loadTokenCacheFromDisk, saveTokenCacheToDisk } from "./duplication";
import type { Graph } from "./model";
import {
  type ComplexFunctionEntry,
  findComplexFunctions,
  findRiskHotspots,
  hasCoverageData,
  type RiskHotspotEntry,
} from "./queries";
import { DefaultResolver } from "./resolver";
import { resolveRef, withWorktree } from "./worktree";

export interface BuildGraphAtRefOptions {
  silent?: boolean | undefined;
  gitStats?: boolean | undefined;
  parallelParsing?: ParallelParsingOption | undefined;
  pathAliases?: Record<string, string[]> | undefined;
}

/**
 * @description Builds the dependency graph as it existed at `ref`, rather than the current
 *   working tree. Resolves `ref` to a commit sha and checks the sha-keyed disk cache
 *   (`branch-graph-cache.ts`) before paying for a `git worktree` checkout + full parse — a given
 *   commit's graph never changes, so the cache never needs invalidation.
 * @param rootDir - Absolute path to the repository root.
 * @param ref - Any git ref (branch, tag, sha, `HEAD~1`, …).
 * @param entryPoints - Entry point files, relative to `rootDir`, to seed the build.
 * @param options - Graph-build options, forwarded to `GraphBuilder` — same shape as `createImportMap`'s.
 * @returns The resolved commit sha and the `Graph` built at that commit.
 */
export async function buildGraphAtRef(
  rootDir: string,
  ref: string,
  entryPoints: string[],
  options: BuildGraphAtRefOptions = {},
): Promise<{ sha: string; graph: Graph }> {
  const sha = resolveRef(rootDir, ref);

  const cached = loadBranchGraph(rootDir, sha);
  if (cached) return { sha, graph: cached };

  const graph = await withWorktree(rootDir, sha, async (worktreeDir) => {
    const resolver = options.pathAliases
      ? new DefaultResolver(worktreeDir, { pathAliases: options.pathAliases })
      : undefined;
    const builder = new GraphBuilder(
      worktreeDir,
      null,
      resolver,
      undefined,
      options.gitStats ?? false,
      new Map(),
      options.parallelParsing ?? true,
    );
    return builder.build(entryPoints);
  });

  saveBranchGraph(rootDir, sha, graph);
  return { sha, graph };
}

export interface FileDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface StaleReference {
  file: string;
  symbol: string;
  stillReferencedBy: string[];
}

export interface DuplicationDelta {
  base: { groups: number };
  head: { groups: number };
  newGroups: DuplicateGroup[];
  resolvedGroups: DuplicateGroup[];
}

export interface ComplexityDelta {
  base: { avgCognitiveComplexity: number };
  head: { avgCognitiveComplexity: number };
  newHotspots: ComplexFunctionEntry[];
  resolvedHotspots: ComplexFunctionEntry[];
}

export interface DocDriftDelta {
  base: { staleCount: number };
  head: { staleCount: number };
  newlyStale: string[];
  resolved: string[];
}

export interface CoverageDelta {
  base: { avgCoveragePct: number };
  head: { avgCoveragePct: number };
  newHotspots: RiskHotspotEntry[];
  resolvedHotspots: RiskHotspotEntry[];
}

export interface BranchComparison {
  base: { ref: string; sha: string };
  head: { ref: string; sha: string };
  files: FileDiff;
  staleReferences: StaleReference[];
  duplication: DuplicationDelta;
  complexity: ComplexityDelta;
  docDrift: DocDriftDelta;
  coverage: CoverageDelta | null;
}

export interface CompareBranchesOptions extends BuildGraphAtRefOptions {
  entryPoints?: string[] | undefined;
  headRef?: string | undefined;
  minDuplicateLines?: number | undefined;
  complexityMetric?: "cognitiveComplexity" | "complexity" | undefined;
  complexityThreshold?: number | undefined;
  maxCoveragePct?: number | undefined;
}

/**
 * @description Computes the file-level import/export/category diff between two graphs — the
 *   basis every other section of a `BranchComparison` builds on.
 * @param baseGraph - The comparison's base graph.
 * @param headGraph - The comparison's head graph.
 * @returns Paths added, removed, or present in both with different imports/exports/category.
 */
export function diffFiles(baseGraph: Graph, headGraph: Graph): FileDiff {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [filePath, headNode] of headGraph.nodes) {
    const baseNode = baseGraph.nodes.get(filePath);
    if (!baseNode) {
      added.push(filePath);
      continue;
    }
    const baseSignature = JSON.stringify({
      category: baseNode.category,
      exports: baseNode.exports.map((exportedSym) => exportedSym.name).sort(),
      imports: baseNode.imports.map((edge) => edge.toPath).sort(),
    });
    const headSignature = JSON.stringify({
      category: headNode.category,
      exports: headNode.exports.map((exportedSym) => exportedSym.name).sort(),
      imports: headNode.imports.map((edge) => edge.toPath).sort(),
    });
    if (baseSignature !== headSignature) changed.push(filePath);
  }
  const removed = [...baseGraph.nodes.keys()].filter((filePath) => !headGraph.nodes.has(filePath));
  return { added, removed, changed };
}

/**
 * @description For every file present in both graphs, flags exported symbols that existed at
 *   base but were removed at head while an importer in the head graph *still* names that symbol
 *   in its import — the "did the user update all call sites" check. A false negative is expected
 *   (and harmless) when a whole importing file was also deleted; a survivor still referencing a
 *   removed export is exactly the missed-update case this exists to catch.
 * @param baseGraph - The comparison's base graph.
 * @param headGraph - The comparison's head graph.
 * @returns One entry per (file, removed symbol) that still has at least one referencing importer.
 */
export function findStaleReferences(baseGraph: Graph, headGraph: Graph): StaleReference[] {
  const staleReferences: StaleReference[] = [];

  for (const [filePath, baseNode] of baseGraph.nodes) {
    const headNode = headGraph.nodes.get(filePath);
    if (!headNode) continue;

    const headExportNames = new Set(headNode.exports.map((exportedSym) => exportedSym.name));
    const removedExports = baseNode.exports
      .map((exportedSym) => exportedSym.name)
      .filter((name) => !headExportNames.has(name));
    if (removedExports.length === 0) continue;

    for (const symbol of removedExports) {
      const stillReferencedBy = [...headGraph.nodes.values()]
        .filter((node) =>
          node.imports.some((edge) => edge.toPath === filePath && edge.symbols?.includes(symbol)),
        )
        .map((node) => node.path);
      if (stillReferencedBy.length > 0) {
        staleReferences.push({ file: filePath, symbol, stillReferencedBy });
      }
    }
  }

  return staleReferences;
}

/** Stable identity for a duplicate group across two graphs — the sorted set of `file:startLine-endLine` occurrences, unaffected by result ordering. */
export function duplicateGroupSignature(group: DuplicateGroup): string {
  return group.occurrences
    .map((occurrence) => `${occurrence.file}:${occurrence.startLine}-${occurrence.endLine}`)
    .sort()
    .join("|");
}

async function diffDuplication(
  rootDir: string,
  baseGraph: Graph,
  headGraph: Graph,
  baseSha: string,
  minLines: number | undefined,
): Promise<DuplicationDelta> {
  const baseTokenCachePath = path.join(
    branchGraphCacheDir(rootDir),
    `${baseSha}-${DEFAULT_DUPLICATION_TOKEN_CACHE_FILE}`,
  );
  const baseTokenCache = loadTokenCacheFromDisk(baseTokenCachePath);
  const [{ groups: baseGroups }, { groups: headGroups }] = await Promise.all([
    findDuplicates(baseGraph, rootDir, { minLines, tokenCache: baseTokenCache }),
    findDuplicates(headGraph, rootDir, { minLines }),
  ]);
  saveTokenCacheToDisk(baseTokenCache, baseTokenCachePath);

  const baseSignatures = new Set(baseGroups.map(duplicateGroupSignature));
  const headSignatures = new Set(headGroups.map(duplicateGroupSignature));

  return {
    base: { groups: baseGroups.length },
    head: { groups: headGroups.length },
    newGroups: headGroups.filter((group) => !baseSignatures.has(duplicateGroupSignature(group))),
    resolvedGroups: baseGroups.filter(
      (group) => !headSignatures.has(duplicateGroupSignature(group)),
    ),
  };
}

function avgCognitiveComplexity(graph: Graph): number {
  const values = [...graph.nodes.values()]
    .map((node) => node.cognitiveComplexity)
    .filter((value): value is number => value !== undefined);
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function diffComplexity(
  baseGraph: Graph,
  headGraph: Graph,
  metric: "cognitiveComplexity" | "complexity" | undefined,
  threshold: number | undefined,
): ComplexityDelta {
  const baseHotspots = findComplexFunctions(baseGraph, { metric, threshold, limit: Infinity });
  const headHotspots = findComplexFunctions(headGraph, { metric, threshold, limit: Infinity });
  const key = (entry: ComplexFunctionEntry) => `${entry.file}:${entry.name}`;
  const baseKeys = new Set(baseHotspots.map(key));
  const headKeys = new Set(headHotspots.map(key));

  return {
    base: { avgCognitiveComplexity: avgCognitiveComplexity(baseGraph) },
    head: { avgCognitiveComplexity: avgCognitiveComplexity(headGraph) },
    newHotspots: headHotspots.filter((entry) => !baseKeys.has(key(entry))),
    resolvedHotspots: baseHotspots.filter((entry) => !headKeys.has(key(entry))),
  };
}

function staleForEntries(graph: Graph): Set<string> {
  const entries = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.type !== "markdown" || !node.staleFor) continue;
    for (const referencedFile of node.staleFor) entries.add(`${node.path}::${referencedFile}`);
  }
  return entries;
}

export function diffDocDrift(baseGraph: Graph, headGraph: Graph): DocDriftDelta {
  const baseEntries = staleForEntries(baseGraph);
  const headEntries = staleForEntries(headGraph);

  return {
    base: { staleCount: baseEntries.size },
    head: { staleCount: headEntries.size },
    newlyStale: [...headEntries].filter((entry) => !baseEntries.has(entry)),
    resolved: [...baseEntries].filter((entry) => !headEntries.has(entry)),
  };
}

function avgCoveragePct(graph: Graph): number {
  const values = [...graph.nodes.values()]
    .map((node) => node.coveragePct)
    .filter((value): value is number => value !== undefined);
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function diffCoverage(
  baseGraph: Graph,
  headGraph: Graph,
  maxCoveragePct: number | undefined,
): CoverageDelta | null {
  if (!hasCoverageData(baseGraph) || !hasCoverageData(headGraph)) return null;

  const baseHotspots = findRiskHotspots(baseGraph, { maxCoveragePct, limit: Infinity }).hotspots;
  const headHotspots = findRiskHotspots(headGraph, { maxCoveragePct, limit: Infinity }).hotspots;
  const key = (entry: RiskHotspotEntry) => `${entry.file}:${entry.name}`;
  const baseKeys = new Set(baseHotspots.map(key));
  const headKeys = new Set(headHotspots.map(key));

  return {
    base: { avgCoveragePct: avgCoveragePct(baseGraph) },
    head: { avgCoveragePct: avgCoveragePct(headGraph) },
    newHotspots: headHotspots.filter((entry) => !baseKeys.has(key(entry))),
    resolvedHotspots: baseHotspots.filter((entry) => !headKeys.has(key(entry))),
  };
}

/**
 * @description Compares a base ref against an already-built head graph (typically the current
 *   working tree / HEAD), reporting a file-level diff, likely-missed rename/removal call sites,
 *   and deltas across every quality tool mokosh already runs on a single graph: duplication
 *   (`find_duplicates`), complexity (`find_complex_functions`), doc drift (`check_doc_drift`),
 *   and — when coverage data is loaded on both sides — risk hotspots (`find_risk_hotspots`).
 * @param rootDir - Absolute path to the repository root.
 * @param baseRef - The ref to compare against (e.g. `"main"`, `"origin/main"`, a commit sha).
 * @param headGraph - The already-built graph for the head side of the comparison.
 * @param options - `headRef` labels the head side in the result (defaults to `"HEAD"`); the rest tune the underlying tool calls and the base-graph build.
 * @returns The full `BranchComparison`.
 */
export async function compareBranches(
  rootDir: string,
  baseRef: string,
  headGraph: Graph,
  options: CompareBranchesOptions = {},
): Promise<BranchComparison> {
  const { sha: baseSha, graph: baseGraph } = await buildGraphAtRef(
    rootDir,
    baseRef,
    options.entryPoints ?? [],
    options,
  );
  const headSha = resolveRef(rootDir, options.headRef ?? "HEAD");

  const [duplication, coverage] = await Promise.all([
    diffDuplication(rootDir, baseGraph, headGraph, baseSha, options.minDuplicateLines),
    Promise.resolve(diffCoverage(baseGraph, headGraph, options.maxCoveragePct)),
  ]);

  return {
    base: { ref: baseRef, sha: baseSha },
    head: { ref: options.headRef ?? "HEAD", sha: headSha },
    files: diffFiles(baseGraph, headGraph),
    staleReferences: findStaleReferences(baseGraph, headGraph),
    duplication,
    complexity: diffComplexity(
      baseGraph,
      headGraph,
      options.complexityMetric,
      options.complexityThreshold,
    ),
    docDrift: diffDocDrift(baseGraph, headGraph),
    coverage,
  };
}
