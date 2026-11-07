# 03 — `find_duplicates` output diet

Rough sizes *(estimated from response length, ~3.5 chars/token)*: summary ~1.5k tokens, `view:full`
slim ~5.5k, `view:full` `slim:false` ~10k.

## Problems *(verified from tool output)*
1. Worktree copies and generated files rank first (fixed by part 01 plus the generated-file check
   on `kotlin/tokens.js`).
2. Overlapping and shifted spans reported as separate groups: `tag-quality.ts`/`tokenizer.ts`
   44-101 vs 69-124; `const.ts`/`resolver.ts` 80-99 vs 88-107; five adjacent `go.ts`/`java.ts`
   fragments.
3. Redundant fields: `fileDuplication` repeats the cluster's file list; `longestMatchAt` repeats the
   first group; `family` is repeated per group; non-slim repeats `{file,startLine,endLine}`.
4. `view:full` returns clusters-with-groups *and* a second group list (`limit:20` yields 40 items).
5. Ranking is by longest match, not score; score 0–1 groups are included.
6. Summary totals look wrong: `matched:500` looks like a cap, `byTopDir` sums to 504, `byFamily` is
   all `js` for TS code, `bySignal` empty, and nothing says how many results were dropped.

## Approach (in order)
1. Coalesce overlapping / near-adjacent occurrences per file pair before clustering
   (`src/graph/duplication/clusters.ts`).
2. Default `minScore` floor and score-based ordering; keep `sort:` override.
3. Compact cluster shape: `{id, files, n, top:"a:85-178 ↔ b:69-159", pct:[..], score}`; move
   `fileDuplication` to drill-down; hoist constant fields.
4. Stable cluster ids and a `cluster:<id>` filter key for drill-down.
5. `maxTokens` / `budget` argument with an explicit "dropped N" notice; add `approxTokens` to every
   response.
6. Fix the summary totals (true count, dropped count, correct `byFamily`).
7. Make `view:full` return nested *or* flat, not both.

## Files
`src/graph/duplication/clusters.ts`, `suffix-duplicates.ts`, `src/mcp/handlers.ts`
(`handleFindDuplicates`), `src/query/dup-parser.ts` / `dup-filter.ts`, `src/mcp/tools.ts`,
`docs/query.md`, `docs/mcp.md`.

## Risks
Changing the response shape breaks consumers and `tool-cli-parity.test.ts`; keep old fields behind
`slim:false` for one release. Disk cache (`duplication-result.json`) is digest-invalidated — bump
its version when the stored shape changes.

## Done when
Summary stays under ~1k tokens, `view:full` under ~3k for this repo, and the same region never
appears twice.
