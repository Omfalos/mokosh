import fs from "node:fs";
import path from "node:path";
import { createImportMap, Graph } from "../index";

/**
 * Reads a serialized graph from a JSON cache file and deserializes it.
 *
 * @param cachePath - Path to the JSON cache file written by {@link saveGraphToCache}
 * @returns The deserialized Graph, or `null` when the file does not exist yet
 */
export function loadGraphFromCache(cachePath: string): Graph | null {
  if (!fs.existsSync(cachePath)) return null;
  const raw = fs.readFileSync(cachePath, "utf-8");
  return Graph.deserialize(JSON.parse(raw));
}

/**
 * Serializes a Graph to JSON and writes it to the given cache file, creating
 * any missing parent directories along the way.
 *
 * @param graph - The Graph instance to persist
 * @param cachePath - Destination path for the JSON cache file; parent directories
 *   are created automatically when they do not exist
 */
export function saveGraphToCache(graph: Graph, cachePath: string): void {
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify(graph.serialize(), null, 2));
}

/**
 * Builds (or incrementally updates) the import graph for the given entry points.
 *
 * @param rootDir - Absolute path to the project root; all entry points are
 *   resolved relative to this directory
 * @param entryPoints - File paths that seed the graph traversal
 * @param cachedGraph - A previously built Graph to reuse as an incremental base,
 *   or `null` to start a full build from scratch
 * @param silent - When `true`, suppresses progress output during the build
 * @returns The fully-built Graph covering all reachable imports
 */
export async function buildGraph(
  rootDir: string,
  entryPoints: string[],
  cachedGraph: Graph | null,
  silent = false,
): Promise<Graph> {
  return createImportMap(rootDir, entryPoints, cachedGraph, { silent });
}
