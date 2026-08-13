/** CLI command: lists duplicated code blocks across the project, mirroring the MCP find_duplicates tool. */
import path from "node:path";
import {
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_IGNORE_DIRS,
  findDuplicates,
  loadTokenCacheFromDisk,
  saveTokenCacheToDisk,
} from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Scans every file in the graph for cross-file (and within-file) duplicated code
 *   and prints the resulting blocks, largest-first. Works for every language mokosh parses —
 *   the underlying detector is token-based, not AST-based, so it doesn't depend on per-language
 *   parser support. Lock files and files under an ignored directory (project config's
 *   `ignoreDirs`, merged with the defaults) are excluded even when the graph itself contains
 *   them — `graph.nodes` isn't ignore-rule-filtered for files reached via a resolved reference
 *   rather than the initial FS walk.
 *
 *   Tokenized files are cached to disk alongside the graph cache (`<cache dir>/duplication-tokens.json`,
 *   next to `graph.json`) so only the *first* run against a repo tokenizes everything cold;
 *   subsequent runs (including `--watch` re-triggers) only re-tokenize files whose `mtime`/`size`
 *   changed.
 * @param {CommandContext} ctx - Shared command context; `ctx.rootDir`, `ctx.scanOptions`,
 *   `ctx.minDuplicateLines`, `ctx.limit`, and `ctx.cachePath` tune the scan.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, rootDir, scanOptions, minDuplicateLines, limit, cachePath } = ctx;
  const minLines = minDuplicateLines ?? 6;
  const ignoreDirs = [
    ...(scanOptions.ignoreDirs ?? DEFAULT_IGNORE_DIRS),
    ...(scanOptions.additionalIgnoreDirs ?? []),
  ];
  const tokenCachePath = path.join(path.dirname(cachePath), DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
  const tokenCache = loadTokenCacheFromDisk(tokenCachePath);
  const { groups } = await findDuplicates(graph, rootDir, {
    minLines,
    limit,
    ignoreDirs,
    tokenCache,
  });
  saveTokenCacheToDisk(tokenCache, tokenCachePath);
  console.log(JSON.stringify({ minLines, groups, count: groups.length }, null, 2));
}
