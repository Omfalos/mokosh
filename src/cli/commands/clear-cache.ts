/** CLI command: deletes the disk graph cache file, mirroring the MCP clear_cache tool. */
import fs from "node:fs";

/**
 * @description Deletes the resolved graph cache file, if present, so the next run rebuilds from scratch.
 * @param {string} cachePath - Absolute path to the cache file (resolved from `--cache` or the default).
 */
export function runClearCache(cachePath: string): void {
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    console.log(`Cache cleared: ${cachePath}`);
  } else {
    console.log(`No cache file present at ${cachePath}`);
  }
}
