/** Disk cache for graphs built at a git ref other than the working tree, keyed by commit sha so entries are immutable and never need invalidation. */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BRANCH_GRAPH_CACHE_DIR, DEFAULT_CACHE_DIR } from "../const";
import { Graph } from "./model";

/**
 * @description Directory holding one cached graph JSON file per commit sha.
 * @param rootDir - Absolute project root.
 * @returns Absolute path to `<rootDir>/mokosh-cache/branch-graphs`.
 */
export function branchGraphCacheDir(rootDir: string): string {
  return path.join(rootDir, DEFAULT_CACHE_DIR, DEFAULT_BRANCH_GRAPH_CACHE_DIR);
}

/**
 * @description Path to the cached graph file for one commit sha.
 * @param rootDir - Absolute project root.
 * @param sha - Full commit sha the graph was built at.
 * @returns Absolute path to `<rootDir>/mokosh-cache/branch-graphs/<sha>.json`.
 */
function branchGraphCachePath(rootDir: string, sha: string): string {
  return path.join(branchGraphCacheDir(rootDir), `${sha}.json`);
}

/**
 * @description Reads and deserializes a previously cached graph for `sha`, if one exists.
 * @param rootDir - Absolute project root.
 * @param sha - Full commit sha to look up.
 * @returns The deserialized `Graph`, or `null` if nothing is cached (or the cache is unreadable).
 */
export function loadBranchGraph(rootDir: string, sha: string): Graph | null {
  const cachePath = branchGraphCachePath(rootDir, sha);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    return Graph.deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * @description Serializes `graph` and writes it to the sha-keyed cache file, creating the
 *   `branch-graphs` directory if needed.
 * @param rootDir - Absolute project root.
 * @param sha - Full commit sha the graph was built at — the cache key.
 * @param graph - The graph to persist.
 */
export function saveBranchGraph(rootDir: string, sha: string, graph: Graph): void {
  const cacheDir = branchGraphCacheDir(rootDir);
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(branchGraphCachePath(rootDir, sha), JSON.stringify(graph.serialize()));
}
