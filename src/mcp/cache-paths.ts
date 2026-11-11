import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MokoshConfig } from "../config";
import {
  DEFAULT_CACHE_DIR,
  DEFAULT_DUPLICATION_RESULT_CACHE_FILE,
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_GRAPH_CACHE_FILE,
  Graph,
} from "../index";

/** Where the disk-persisted `find_duplicates` token cache for `root` lives — shared with the
 *  CLI's `mokosh-cache/` directory (`src/cli/graph-loader.ts`) so a CLI run and an MCP session
 *  against the same root warm each other's cache. */
export function duplicationTokenCachePath(root: string): string {
  return path.join(root, DEFAULT_CACHE_DIR, DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
}

/** Where the disk-persisted `find_duplicates` *result* cache for `root` lives — the full
 *  `{ groups, clusters }` from the last scan, digest-gated (see
 *  `src/graph/duplication/result-cache-store.ts`). Honors the same `mokosh.config.*` `cachePath`
 *  override as the graph cache. On a monorepo, pass `pkgName` for a per-package file so one
 *  package's edits don't invalidate every other package's cached result. */
export function resolveDuplicationResultCachePath(
  root: string,
  config: MokoshConfig | undefined,
  pkgName?: string,
): string {
  const dir = config?.cachePath
    ? path.dirname(path.resolve(root, config.cachePath))
    : path.join(root, DEFAULT_CACHE_DIR);
  if (!pkgName) return path.join(dir, DEFAULT_DUPLICATION_RESULT_CACHE_FILE);
  const slug = crypto.createHash("sha1").update(pkgName).digest("hex").slice(0, 8);
  return path.join(dir, `duplication-result-${slug}.json`);
}

/** Where the CLI's disk-persisted graph cache for `root` lives, honoring the same
 *  `mokosh.config.*` `cachePath` override the CLI itself resolves against
 *  (`src/cli/config.ts`'s `resolveCachePath`) — falls back to `<root>/mokosh-cache/graph.json`. */
export function graphCachePath(root: string, config: MokoshConfig | undefined): string {
  return config?.cachePath
    ? path.resolve(root, config.cachePath)
    : path.join(root, DEFAULT_CACHE_DIR, DEFAULT_GRAPH_CACHE_FILE);
}

/** The resolved `mokosh-cache` directory for `root` (honoring a `mokosh.config.*` `cachePath`
 *  override) — the workspace graph cache lives in its `workspace/` subdir as a manifest plus one
 *  file per package (`src/graph/workspace/disk-cache.ts`). */
export function workspaceCacheDir(root: string, config: MokoshConfig | undefined): string {
  return config?.cachePath
    ? path.dirname(path.resolve(root, config.cachePath))
    : path.join(root, DEFAULT_CACHE_DIR);
}

/**
 * @description Reads and deserializes a CLI-written graph cache from disk, for seeding a
 *   session's first `analyze` call. Never throws: a missing file, malformed JSON, or a value
 *   that fails to deserialize all degrade to `null` (today's cold-start behavior) rather than
 *   failing the tool call that triggered the read — this is pure acceleration, and
 *   `createImportMap` re-validates every seeded node against the live filesystem (mtime+size)
 *   before trusting it, so a stale or foreign cache file can only cost a re-parse, never produce
 *   wrong data.
 * @param cachePath - Path to the JSON file written by `saveGraphToCache` (`src/cli/graph-loader.ts`).
 * @returns The deserialized `Graph`, or `null` if nothing usable was found.
 */
export function loadDiskGraphSeed(cachePath: string): Graph | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, "utf-8");
    return Graph.deserialize(JSON.parse(raw));
  } catch {
    return null;
  }
}
