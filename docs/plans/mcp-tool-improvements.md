# Plan: MCP tool improvements

Status: partially landed (as of 2026-10-01: workstream 3's `get_risk_score` and `diff_graph`
shipped — the latter as `compare_branches`, see below — and workstream 4 shipped; workstreams 1,
2, and 5, plus batch variants, remain proposed). Source: brainstorm from a review of `src/mcp/*`
(25 tools at the time, now 26, `capabilities: { tools: {} }` only) against `docs/mcp.md` on
2026-08-12.

## Context

The MCP server currently exposes 25 tools and nothing else — `server.ts` declares only
`capabilities: { tools: {} }`. `SessionState` (`src/mcp/cache.ts`) already tracks per-root
dirty state via an FS watcher (`dirtyRoots`, `watchers`) but nothing surfaces that to a caller;
the only way to refresh a stale graph today is to call `analyze` again or `clear_cache`. This
plan lists independent workstreams, roughly ordered by leverage. Each is separable — pick and
implement individually.

## 1. New MCP capabilities beyond tools (highest leverage)

**Resources** — expose the cached graph / API surface / feature graph as MCP resources so a
host can attach graph context without a tool round-trip. Candidate resource URIs: the
serialized graph, `get_api_surface` output, `get_feature_graph` output, per root.

**Prompts** — ship canned prompt templates that chain existing tools, mirroring what the
`/pre-update` and `/mokosh` skills already do by hand:
- "pre-refactor blast-radius check" → `analyze` → `get_affected` → `find_uncovered`
- "onboard me to this codebase" → `analyze` → `get_feature_graph` → `get_module_responsibility`

**Progress notifications** — `analyze` and `find_duplicates` can run long on large repos.
Wire `ProgressToken` support so hosts can render real progress instead of a blocking call.

Files touched: `src/mcp/server.ts` (capabilities registration + new request handlers),
new `src/mcp/resources.ts` / `src/mcp/prompts.ts`.

## 2. Session/cache ergonomics

**`get_cache_status` tool** — surface `SessionState`'s existing `dirtyRoots` / `watchers` /
`lastAnalyze` bookkeeping (`src/mcp/cache.ts`) so a caller can check "is my cached graph stale?"
instead of guessing when to call `clear_cache`.

**Auto-revalidate on dirty** — the `dirtyRoots` machinery already exists from the FS watcher;
extend tool handlers to transparently rebuild before serving a stale read instead of requiring
an explicit re-`analyze`. Needs care: silent rebuilds change latency characteristics tools
currently promise (`get_affected` with `cached: true` claims O(1)).

Files touched: `src/mcp/cache.ts`, `src/mcp/handlers.ts`, `src/mcp/tools.ts` (new tool schema).

## 3. New analysis tools (compose existing primitives)

**`get_risk_score` — done (2026-08-20), shipped as `find_risk_hotspots`.** Combines complexity
(`complexity`/`cognitiveComplexity`) + low coverage (`coveragePct`) + optional churn
(`commitCount90d`, when `gitStats` is enabled) into one worst-first hotspot list, per-function
rather than per-file. See `src/graph/*` risk-hotspot logic, `src/mcp/handlers.ts`
(`handleFindRiskHotspots`), and `docs/mcp.md`'s `find_risk_hotspots` entry.

**`diff_graph` — done (2026-08-28), shipped as `compare_branches`.** Compares the current graph
against a `baseRef`: file diff, stale post-rename references, and deltas for duplication,
complexity, doc drift, and coverage/risk hotspots — a superset of what this item proposed.
Summary-first (`verdict` + capped delta lists), `detail: "full"` for everything. See
[ADR-016](../adr-016-branch-comparison.md) and `docs/mcp.md`'s `compare_branches` entry.

**Batch variants** — `get_dependencies` / `get_affected` for multiple files in one call, to
cut round-trips for multi-file changesets (the common case feeding `propose_tags`-style
workflows).

Files touched: `src/mcp/handlers.ts`, `src/mcp/tools.ts`, likely new `src/graph/risk.ts` for
the scoring logic (keep handlers thin per existing module conventions).

## 4. Tool-definition weight — done (2026-08-20)

Measured: descriptions totaled 14,507 chars (~3,627 tokens) of the file's ~6,094-token
`ListTools` payload; every tool already has a full writeup in `docs/mcp.md`, so most of that
was duplicated prose. Trimmed the 6 tools over ~700 chars (`find_duplicates`, `query`,
`get_affected`, `find_symbol`, `get_api_surface`, `apply_tags`) to a one-sentence description +
`docs/mcp.md` pointer, keeping load-bearing param-level descriptions and correctness caveats
(e.g. `find_symbol`'s `precision` field) intact. Left the other 19 tools (already 168–663 chars)
unchanged. Result: 14,507 → 11,764 chars (~2,941 tokens), ~19% cut off the file's total token
footprint. `npm run typecheck` and `src/mcp/**/*.test.ts` pass unchanged.

## 5. Output size / pagination

`query` (`slim: false`) and `find_duplicates` can still return large payloads on big repos.
Consider cursor-based pagination, consistent with the `limit` params already used by
`find_duplicates`, `find_complex_functions`, etc.

## Suggested order

1. ~~`get_risk_score` (workstream 3)~~ — done, see workstream 3.
2. ~~`diff_graph` (workstream 3)~~ — done, shipped as `compare_branches`, see workstream 3.
3. ~~Tool-definition trimming (workstream 4)~~ — done, see workstream 4.
4. Resources + prompts (workstream 1) — structural, unlocks host-side UX improvements.
5. `get_cache_status` (workstream 2) — small, complements #4's auto-revalidate if pursued.
6. Batch variants (workstream 3) — nice-to-have, lower urgency.
7. Pagination (workstream 5) — measure first, may not be worth the churn.

Run `/pre-update` before starting any of these to confirm current blast radius, since
`src/mcp/handlers.ts` and `src/mcp/tools.ts` are shared by every tool.