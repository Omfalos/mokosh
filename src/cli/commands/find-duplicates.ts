/** CLI command: lists duplicated code blocks across the project, mirroring the MCP find_duplicates tool. */
import path from "node:path";
import {
  DEFAULT_DUPLICATION_RESULT_CACHE_FILE,
  DEFAULT_DUPLICATION_TOKEN_CACHE_FILE,
  DEFAULT_IGNORE_DIRS,
  type DuplicationResultParams,
  duplicationDigest,
  duplicationResultCacheKey,
  findDuplicates,
  loadDuplicationResult,
  loadTokenCacheFromDisk,
  parseDupQuery,
  saveDuplicationResult,
  saveTokenCacheToDisk,
  slimDupCluster,
  slimDupGroup,
  sortLimitDupGroups,
  summarizeDuplicates,
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
 *   changed. On top of that, an unfiltered run's full `{ groups, clusters }` is cached to
 *   `<cache dir>/duplication-result.json`, keyed by a digest of every graph node's `mtime`/`size`
 *   plus the scan params — a repeat run with nothing changed skips the scan entirely. A
 *   `--dup-query` run always re-scans. Shared with the MCP server.
 *   Also prints `clusters` — the same groups bucketed by exact file set (with per-file
 *   duplication coverage %), so N separate non-nested matches between the same two files read as
 *   one entry instead of N rows (see docs/known_issues/09-duplicate-clone-family-noise.md).
 *   Same-file-only matches (a file duplicating itself) are excluded by default — pass
 *   `--include-same-file` or set `duplication.includeSameFile` to see them. Inline-SVG-markup
 *   matches (two different icon components sharing a literal-normalized `<svg>` skeleton) are
 *   likewise excluded — pass `--include-svg-markup` or set `duplication.includeSvgMarkup`.
 *   Test-file duplication is excluded by default too — pass `--scope tests` for only the
 *   substantive shared-test-logic clusters, or `--scope all` for everything.
 *
 *   Output leads with a `summary` block (counts by family / top-level dir / signal). `--dup-query
 *   "key:value,…"` narrows the result the same way the MCP tool's `filter` does. The printed
 *   groups/clusters are the compact shape by default; pass `--dup-full` for source text and
 *   per-occurrence metadata.
 * @param {CommandContext} ctx - Shared command context; `ctx.rootDir`, `ctx.scanOptions`,
 *   `ctx.minDuplicateLines`, `ctx.limit`, `ctx.duplicateScope`, `ctx.dupQuery`, `ctx.dupSlim`,
 *   and `ctx.cachePath` tune the scan and its output.
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
    includeDocs,
    duplicateScope,
    dupQuery,
    dupSlim,
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
  // Parse up front so a malformed --dup-query fails before the scan, not after.
  const parsedQuery = dupQuery ? parseDupQuery(dupQuery) : undefined;
  // With a filter, take every match back from the scan (its own `limit` would truncate before
  // this command can re-sort or summarize) and cap here; without one, let the scan cap.
  const scanLimit = parsedQuery ? Number.MAX_SAFE_INTEGER : limit;

  const scanArgs = {
    minLines,
    limit: scanLimit,
    ignoreDirs,
    includeGenerated: includeGenerated || ctx.rawConfig.duplication?.includeGenerated || false,
    includeSameFile: includeSameFile || ctx.rawConfig.duplication?.includeSameFile || false,
    includeSvgMarkup: includeSvgMarkup || ctx.rawConfig.duplication?.includeSvgMarkup || false,
    includeDocs: includeDocs || ctx.rawConfig.duplication?.includeDocs || false,
    scope: duplicateScope ?? ctx.rawConfig.duplication?.scope,
    ignoreGlobs: ctx.rawConfig.duplication?.ignoreGlobs ?? [],
  };
  // Result cache: an unfiltered run's full `{ groups, clusters }` is persisted to disk keyed by
  // a digest of the graph nodes' mtime/size + the scan params, so a repeat run with nothing
  // changed skips the whole scan. Shared with the MCP server via `mokosh-cache/`. A --dup-query
  // run always scans (the filter is applied inside findDuplicates, pre-clustering).
  const resultCachePath = path.join(path.dirname(cachePath), DEFAULT_DUPLICATION_RESULT_CACHE_FILE);
  // `ignoreLiterals` / `maxPunctuationRatio` aren't passed by this command, so they take
  // `findDuplicates`' own defaults — mirror those literals here so the key matches the MCP one.
  const resultParams: DuplicationResultParams = {
    minLines,
    ignoreLiterals: true,
    maxPunctuationRatio: 0.5,
    // `scanLimit` is `limit` on an unfiltered run; `findDuplicates`' own default is 50.
    limit: limit ?? 50,
    scope: scanArgs.scope,
    includeGenerated: scanArgs.includeGenerated,
    includeSameFile: scanArgs.includeSameFile,
    includeSvgMarkup: scanArgs.includeSvgMarkup,
    includeDocs: scanArgs.includeDocs,
    ignoreDirs,
    ignoreGlobs: scanArgs.ignoreGlobs,
  };
  const useResultCache = parsedQuery === undefined;
  const digest = useResultCache ? duplicationDigest(graph.nodes.values()) : "";
  const paramsKey = useResultCache ? duplicationResultCacheKey(resultParams) : "";
  const cachedResult = useResultCache
    ? loadDuplicationResult(resultCachePath, digest, paramsKey)
    : null;

  let groups: Awaited<ReturnType<typeof findDuplicates>>["groups"];
  let clusters: Awaited<ReturnType<typeof findDuplicates>>["clusters"];
  if (cachedResult) {
    ({ groups, clusters } = cachedResult);
  } else {
    ({ groups, clusters } = await findDuplicates(graph, rootDir, {
      ...scanArgs,
      ...(dupQuery !== undefined && { filter: dupQuery }),
      tokenCache,
    }));
    saveTokenCacheToDisk(tokenCache, tokenCachePath);
    if (useResultCache) {
      saveDuplicationResult(resultCachePath, digest, paramsKey, groups, clusters);
    }
  }

  // `findDuplicates` already applied the `--dup-query` predicate (pre-clustering). `summary`
  // describes the whole matched set; then the DSL's `sort`/`limit` shape what's printed.
  const summary = summarizeDuplicates(groups);
  // Match the scan's own default cap (50) when neither --limit nor a DSL `limit:` is given, so a
  // filtered run stays bounded by default — pass `limit:<big>` in --dup-query to lift it.
  const effectiveLimit = parsedQuery?.limit ?? limit ?? 50;
  const orderedGroups = parsedQuery
    ? sortLimitDupGroups(groups, { ...parsedQuery, limit: effectiveLimit })
    : groups;
  const limitedClusters = clusters.slice(0, effectiveLimit);
  const outGroups = dupSlim ? orderedGroups.map(slimDupGroup) : orderedGroups;
  const outClusters = dupSlim ? limitedClusters.map(slimDupCluster) : limitedClusters;
  console.log(
    JSON.stringify(
      {
        minLines,
        ...(dupQuery !== undefined && { filter: dupQuery }),
        summary,
        groups: outGroups,
        count: outGroups.length,
        clusters: outClusters,
      },
      null,
      2,
    ),
  );
}
