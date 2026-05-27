import fs from "node:fs";
import path from "node:path";
import { createImportMap, Graph } from "../index";

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
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(graph.serialize(), null, 2));
}

/**
 * @description Builds (or incrementally updates) the import graph for the given entry points.
 * @param {string} rootDir - Absolute path to the project root; entry points are resolved relative to this.
 * @param {string[]} entryPoints - File paths that seed the graph traversal.
 * @param {Graph | null} cachedGraph - A previously built `Graph` to reuse as an incremental base, or `null` for a full build.
 * @param {boolean} [silent=false] - When `true`, suppresses progress output during the build.
 * @param {boolean} [gitStats=false] - When `true`, attaches git churn data to each node.
 * @returns {Promise<Graph>} The fully-built `Graph` covering all reachable imports.
 */
export async function buildGraph(
  rootDir: string,
  entryPoints: string[],
  cachedGraph: Graph | null,
  silent = false,
  gitStats = false,
): Promise<Graph> {
  return createImportMap(rootDir, entryPoints, cachedGraph, { silent, gitStats });
}
