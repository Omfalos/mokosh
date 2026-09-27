/** Loads the dependency graph from a JSON disk cache or builds it fresh if the cache is missing. */
import fs from "node:fs";
import path from "node:path";
import { ensureCacheDir } from "../cache-dir";
import type { MokoshConfig } from "../config";
import { loadCoverageMap } from "../coverage";
import { getOrRunCoverage } from "../graph/coverage/get-or-run";
import { applyStaticCoverage } from "../graph/coverage/static-estimate";
import { enrichCoverage } from "../graph/enrichment";
import { detectMonorepo } from "../graph/workspace";
import { configToGraphOptions, createImportMap, Graph } from "../index";

/**
 * @description Reads a serialized graph from a JSON cache file and deserializes it.
 * @param {string} cachePath - Path to the JSON cache file written by `saveGraphToCache`.
 * @returns {Graph | null} The deserialized `Graph`, or `null` when the file does not exist yet.
 */
export function loadGraphFromCache(cachePath: string): Graph | null {
  if (!fs.existsSync(cachePath)) return null;
  const raw = fs.readFileSync(cachePath, "utf-8");
  return Graph.deserialize(JSON.parse(raw));
}

/**
 * @description Serializes a `Graph` to JSON and writes it to the given cache file,
 *   creating any missing parent directories along the way.
 * @param {Graph} graph - The `Graph` instance to persist.
 * @param {string} cachePath - Destination path for the JSON cache file; parent directories are created automatically.
 */
export function saveGraphToCache(graph: Graph, cachePath: string): void {
  const cacheDir = path.dirname(cachePath);
  ensureCacheDir(cacheDir);
  fs.writeFileSync(cachePath, JSON.stringify(graph.serialize(), null, 2));
}

/**
 * @description Builds (or incrementally updates) the import graph for the given entry points.
 * @param {string} rootDir - Absolute path to the project root; entry points are resolved relative to this.
 * @param {string[]} entryPoints - File paths that seed the graph traversal.
 * @param {Graph | null} cachedGraph - A previously built `Graph` to reuse as an incremental base, or `null` for a full build.
 * @param {object} [options] - `silent` suppresses progress output; the rest is the graph-build subset of `MokoshConfig` — build via {@link configToGraphOptions}.
 * @returns {Promise<Graph>} The fully-built `Graph` covering all reachable imports.
 */
export async function buildGraph(
  rootDir: string,
  entryPoints: string[],
  cachedGraph: Graph | null,
  options: { silent?: boolean } & ReturnType<typeof configToGraphOptions> = {
    silent: false,
    ...configToGraphOptions(undefined),
  },
): Promise<Graph> {
  return createImportMap(rootDir, entryPoints, cachedGraph, options);
}

/**
 * @description Populates `coveragePct` on every node of an already-built `graph`, mirroring the
 *   MCP server's `handleAnalyze` + `SessionState.getOrBuild` behaviour: `coverageReportPath`
 *   (an explicit pre-generated report) takes priority when set; otherwise, `coverage.mode`
 *   picks between an instant static reachability estimate (`"static"`) and running (or reusing
 *   the digest-cached result of) each detected package's own test suite (`"exec"`). A no-op when
 *   none of these is configured. Mutates `graph` in place.
 * @param rootDir - Absolute project/monorepo root.
 * @param graph - The built (or monorepo-flattened) `Graph` to enrich.
 * @param config - The loaded `MokoshConfig`.
 */
export async function applyConfiguredCoverage(
  rootDir: string,
  graph: Graph,
  config: MokoshConfig,
): Promise<void> {
  if (config.coverageReportPath) {
    const coverageMap = loadCoverageMap(rootDir, config.coverageReportPath);
    if (coverageMap.size > 0) enrichCoverage(graph.nodes, coverageMap);
    return;
  }
  if (config.coverage?.mode === "static") {
    applyStaticCoverage(graph);
    return;
  }
  if (config.coverage?.mode !== "exec") return;
  const layout = detectMonorepo(rootDir);
  const autoMap = await getOrRunCoverage(rootDir, graph.nodes.values(), layout, {
    timeoutMs: config.coverage.timeoutMs,
    packages: config.coverage.packages,
  });
  if (autoMap.size > 0) enrichCoverage(graph.nodes, autoMap);
}
