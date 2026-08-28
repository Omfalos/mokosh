/** CLI command: deletes the disk graph cache file (and the disk duplication token cache and
 *  branch-graph cache alongside it), mirroring the MCP clear_cache tool. */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_BRANCH_GRAPH_CACHE_DIR, DEFAULT_DUPLICATION_TOKEN_CACHE_FILE } from "../../index";

/**
 * @description Deletes the resolved graph cache file, the disk duplication token cache next to
 *   it, and the `branch-graphs/` directory of sha-keyed comparison graphs (`--compare-branches`),
 *   if present, so the next run rebuilds and re-tokenizes from scratch.
 * @param {string} cachePath - Absolute path to the graph cache file (resolved from `--cache` or the default).
 */
export function runClearCache(cachePath: string): void {
  const cacheDir = path.dirname(cachePath);
  const tokenCachePath = path.join(cacheDir, DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
  const branchGraphDir = path.join(cacheDir, DEFAULT_BRANCH_GRAPH_CACHE_DIR);
  let clearedAny = false;
  for (const target of [cachePath, tokenCachePath]) {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      console.log(`Cache cleared: ${target}`);
      clearedAny = true;
    }
  }
  if (fs.existsSync(branchGraphDir)) {
    fs.rmSync(branchGraphDir, { recursive: true, force: true });
    console.log(`Cache cleared: ${branchGraphDir}`);
    clearedAny = true;
  }
  if (!clearedAny) {
    console.log(`No cache file present at ${cachePath}`);
  }
}
