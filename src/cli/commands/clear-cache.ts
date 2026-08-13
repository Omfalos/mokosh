/** CLI command: deletes the disk graph cache file (and the disk duplication token cache
 *  alongside it), mirroring the MCP clear_cache tool. */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DUPLICATION_TOKEN_CACHE_FILE } from "../../index";

/**
 * @description Deletes the resolved graph cache file and the disk duplication token cache next
 *   to it, if present, so the next run rebuilds and re-tokenizes from scratch.
 * @param {string} cachePath - Absolute path to the graph cache file (resolved from `--cache` or the default).
 */
export function runClearCache(cachePath: string): void {
  const tokenCachePath = path.join(path.dirname(cachePath), DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
  let clearedAny = false;
  for (const target of [cachePath, tokenCachePath]) {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      console.log(`Cache cleared: ${target}`);
      clearedAny = true;
    }
  }
  if (!clearedAny) {
    console.log(`No cache file present at ${cachePath}`);
  }
}
