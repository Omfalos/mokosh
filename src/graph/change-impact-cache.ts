/** Pre-computed blast-radius cache: maps each file to the set of files that would be affected if it changed. */
import fs from "node:fs";
import path from "node:path";
import type { Graph } from "./model";

/**
 * Pre-computed blast-radius map for every file in the graph.
 *
 * At small scales (< ~500 nodes) the live `graph.traverse` approach used by
 * `get_affected` is fast enough (< 1ms per query). The cache pays off when:
 *   - The same file is queried many times in one session (O(1) vs O(n) per call)
 *   - The codebase exceeds ~1000 nodes and traversal cost becomes noticeable
 *   - The cache is persisted to disk and reused across MCP restarts
 */
export interface ChangeImpactCache {
  /**
   * Map from project-relative file path to the list of all files that are
   * transitively affected if that file changes (incoming traversal).
   */
  impact: Map<string, string[]>;
  /**
   * Fingerprint of the graph this cache was built from.
   * Used to detect stale caches without re-traversing the graph.
   */
  graphHash: string;
}

/** Wire format written to `.mokosh/change-impact-cache.json`. */
interface SerializedChangeImpactCache {
  graphHash: string;
  impact: [string, string[]][];
}

/**
 * Computes a lightweight fingerprint of the graph by hashing the sorted list of
 * `path:mtime:size` tuples for every node. Any file addition, deletion, or
 * modification will produce a different hash.
 *
 * @param graph - The graph to fingerprint.
 * @returns A hex string hash.
 */
export function computeGraphHash(graph: Graph): string {
  const entries = [...graph.nodes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, n]) => `${p}:${n.mtime}:${n.size}`)
    .join("|");

  // FNV-1a 32-bit — fast, deterministic, good enough for cache invalidation.
  let hash = 0x811c9dc5;
  for (let i = 0; i < entries.length; i++) {
    hash ^= entries.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Pre-computes the incoming blast-radius for every node in the graph.
 *
 * Runs one incoming traversal per node — O(n²) worst case but performed once.
 * Results are stored in a `Map` for O(1) subsequent lookups.
 *
 * @param graph - The import graph to pre-compute.
 * @returns A `ChangeImpactCache` ready for `queryChangeImpact`.
 */
export function buildChangeImpactCache(graph: Graph): ChangeImpactCache {
  const impact = new Map<string, string[]>();

  for (const filePath of graph.nodes.keys()) {
    const affected: string[] = [];
    graph.traverse(
      filePath,
      (node) => {
        if (node.path !== filePath) affected.push(node.path);
        return true;
      },
      { direction: "incoming" },
    );
    impact.set(filePath, affected);
  }

  return { impact, graphHash: computeGraphHash(graph) };
}

/**
 * Returns the list of files transitively affected by a change in `filePath`.
 * Falls back to an empty array when the file is not in the cache.
 *
 * @param cache - A previously built `ChangeImpactCache`.
 * @param filePath - Project-relative path of the changed file.
 * @returns Sorted list of affected file paths.
 */
export function queryChangeImpact(cache: ChangeImpactCache, filePath: string): string[] {
  return cache.impact.get(filePath) ?? [];
}

/**
 * Returns `true` when `cache` was built from the same graph as `graph`.
 * Use this before trusting a deserialized cache loaded from disk.
 *
 * @param cache - The cache to validate.
 * @param graph - The current graph to compare against.
 * @returns `true` if the cache is still valid for this graph.
 */
export function isChangeImpactCacheValid(cache: ChangeImpactCache, graph: Graph): boolean {
  return cache.graphHash === computeGraphHash(graph);
}

/**
 * Serializes a `ChangeImpactCache` to JSON and writes it to `cachePath`,
 * creating parent directories as needed.
 *
 * @param cache - The cache to persist.
 * @param cachePath - Absolute path to write the JSON file.
 */
export function saveChangeImpactCache(cache: ChangeImpactCache, cachePath: string): void {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const serialized: SerializedChangeImpactCache = {
    graphHash: cache.graphHash,
    impact: [...cache.impact.entries()],
  };
  fs.writeFileSync(cachePath, JSON.stringify(serialized));
}

/**
 * Reads and deserializes a `ChangeImpactCache` from disk.
 * Returns `null` when the file does not exist or cannot be parsed.
 *
 * @param cachePath - Absolute path to the JSON file written by `saveChangeImpactCache`.
 * @returns The deserialized cache, or `null` on failure.
 */
export function loadChangeImpactCache(cachePath: string): ChangeImpactCache | null {
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as SerializedChangeImpactCache;
    return {
      graphHash: parsed.graphHash,
      impact: new Map(parsed.impact),
    };
  } catch {
    return null;
  }
}
