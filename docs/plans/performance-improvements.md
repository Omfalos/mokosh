# Plan: performance improvements

Status: proposed, not started. Source: review of `src/graph/builder.ts`, `src/graph/resolver.ts`,
`src/graph/duplication/*`, and `src/mcp/cache.ts` on 2026-08-12, plus known regressions recorded
in project memory (`project_worker_pool_threshold.md`).

## Where time actually goes today

```
analyze (cold)  →  FS walk + parse (parallel, wavefront) → resolve imports (recursive, per-file,
                   cached per build by (importer dir, lang bucket, specifier))
                →  git stats (2 batched `git log`, opt-in)  →  6 enrichment passes (full graph scan each)
analyze (warm)  →  mtime+size check per node → re-parse only changed files
find_duplicates →  tokenize (worker pool ≥20 files, cached by mtime+size) → suffix array O(n log n)
get_affected    →  full incoming traversal, or O(1) via prebuilt ChangeImpactCache
```

The architecture already has real performance engineering behind it (piscina worker pool,
incremental mtime/size reuse, batched git log instead of per-file, suffix-array duplicate
detection instead of pairwise, per-session duplication token cache). The opportunities below are
what's left, not what's missing.

 1 1`get_affected` cache build cost is hidden until first `cached: true` call

`buildChangeImpactCache()` builds an O(1)-lookup structure lazily on first use per
`docs/mcp.md`. Worth confirming whether repeated `analyze` calls (incremental rebuilds) properly
invalidate/rebuild this cache rather than serving stale impact data — if the cache isn't tied to
the same dirty-tracking as `SessionState.dirtyRoots`, a stale `cached: true` result is a
correctness bug disguised as a performance feature. **Action:** trace `changeImpactCaches`
lifecycle in `src/mcp/cache.ts` against `dirtyRoots` invalidation; write a regression test if the
two aren't coupled.

## 2. Disk cache (CLI) vs. session cache (MCP) are two independent cache designs

`src/cli/graph-loader.ts` has its own disk-backed cache; `src/mcp/cache.ts` has its own in-memory
session cache. Both re-implement "is this graph still valid" logic independently. **Action (low
priority, mostly a maintenance win, not a perf win):** consider whether the CLI's disk cache
could seed the MCP server's first `analyze` call in a given session (skip cold parse entirely
when a valid on-disk cache already exists for that root), rather than the MCP server always
parsing fresh on session start.

## Suggested order

1. Correctness check on `ChangeImpactCache` invalidation (#1) — do this regardless of whether
   it's fixed, since serving stale data silently is worse than being slow.
2. Everything else (#2) — measure-first, pursue only where profiling shows real cost.

The worker-pool threshold regression (`DEFAULT_MIN_FILES_FOR_POOL`) is no longer tracked here —
it was fixed directly in `src/graph/builder.ts` (raised to 600; see `project_worker_pool_threshold.md`).

Resolver specifier-resolution caching (formerly tracked here as item #1) is no longer tracked —
it was implemented directly in `src/graph/resolver.ts` (per-build `resolutionCache` on
`DefaultResolver`, keyed by importer directory + lang-resolver bucket + specifier, with
negative-result caching).

The six-pass enrichment scan (formerly tracked here as item #1) is no longer tracked — it was
fused into a single exported entry point, `enrichGraph`, called once from `GraphBuilder.build()`;
each original pass is kept as a standalone export for targeted testing. See
`docs/architecture.md`'s Enrichment section.

`find_duplicates`'s cold-first-call tokenizing cost (formerly tracked here as item #1) is no
longer tracked — the disk-persistence half of that item was implemented directly:
`src/graph/duplication/token-cache-store.ts` persists the token cache to
`<root>/mokosh-cache/duplication-tokens.json`, wired into both the CLI
(`src/cli/commands/find-duplicates.ts`, which previously had no caching at all) and the MCP
server (`src/mcp/cache.ts`'s `SessionState`, which now hydrates from disk on a session's first
access instead of starting empty). The progress-notifications half of that item was explicitly
descoped, not implemented — no MCP progress-token plumbing exists anywhere in this codebase yet,
and it would be new infrastructure rather than a fit for this item's disk-cache scope.

## What NOT to do

Don't reach for a rewrite of the resolver or a switch to a different parsing backend (e.g. from
the TS compiler API) speculatively — `project_ts7_compiler_api_risk.md` already flags that
TypeScript 7's native-compiler API isn't ready to build against yet. Perf work here should stay
inside the current architecture (caching, batching, thresholds), not a platform swap.