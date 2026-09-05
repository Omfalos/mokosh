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
 *   parser support. Lock files, files under an ignored directory (project config's
 *   `ignoreDirs`, merged with the defaults), and generated / vendored files (protobuf output,
 *   `*.generated.*`, `generated/` dirs, `@generated`-marked files — pass `--include-generated`
 *   or set `duplication.includeGenerated` to scan them) are excluded even when the graph itself
 *   contains them — `graph.nodes` isn't ignore-rule-filtered for files reached via a resolved
 *   reference rather than the initial FS walk.
 *
 *   Tokenized files are cached to disk alongside the graph cache (`<cache dir>/duplication-tokens.json`,
 *   next to `graph.json`) so only the *first* run against a repo tokenizes everything cold;
 *   subsequent runs (including `--watch` re-triggers) only re-tokenize files whose `mtime`/`size`
 *   changed.
 *   Also prints `clusters` — the same groups bucketed by exact file set (with per-file
 *   duplication coverage %), so N separate non-nested matches between the same two files read as
 *   one entry instead of N rows (see docs/known_issues/09-duplicate-clone-family-noise.md).
 *   Same-file-only matches (a file duplicating itself) are excluded by default — pass
 *   `--include-same-file` or set `duplication.includeSameFile` to see them. Inline-SVG-markup
 *   matches (two different icon components sharing a literal-normalized `<svg>` skeleton) are
 *   likewise excluded — pass `--include-svg-markup` or set `duplication.includeSvgMarkup`.
 *   Test-file duplication is excluded by default too — pass `--scope tests` for only the
 *   substantive shared-test-logic clusters, or `--scope all` for everything.
 * @param {CommandContext} ctx - Shared command context; `ctx.rootDir`, `ctx.scanOptions`,
 *   `ctx.minDuplicateLines`, `ctx.limit`, `ctx.duplicateScope`, and `ctx.cachePath` tune the scan.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const {
    graph,
    rootDir,
    scanOptions,
    minDuplicateLines,
    includeGenerated,
    includeSameFile,
    includeSvgMarkup,
    duplicateScope,
    limit,
    cachePath,
  } = ctx;
  const minLines = minDuplicateLines ?? 6;
  const ignoreDirs = [
    ...(scanOptions.ignoreDirs ?? DEFAULT_IGNORE_DIRS),
    ...(scanOptions.additionalIgnoreDirs ?? []),
  ];
  const tokenCachePath = path.join(path.dirname(cachePath), DEFAULT_DUPLICATION_TOKEN_CACHE_FILE);
  const tokenCache = loadTokenCacheFromDisk(tokenCachePath);
  const { groups, clusters } = await findDuplicates(graph, rootDir, {
    minLines,
    limit,
    ignoreDirs,
    includeGenerated: includeGenerated || ctx.rawConfig.duplication?.includeGenerated || false,
    includeSameFile: includeSameFile || ctx.rawConfig.duplication?.includeSameFile || false,
    includeSvgMarkup: includeSvgMarkup || ctx.rawConfig.duplication?.includeSvgMarkup || false,
    scope: duplicateScope ?? ctx.rawConfig.duplication?.scope,
    ignoreGlobs: ctx.rawConfig.duplication?.ignoreGlobs ?? [],
    tokenCache,
  });
  saveTokenCacheToDisk(tokenCache, tokenCachePath);
  console.log(JSON.stringify({ minLines, groups, count: groups.length, clusters }, null, 2));
}
