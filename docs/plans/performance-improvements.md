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

## 1. Enrichment passes are six full-graph scans, not one — RESOLVED

~~`src/graph/enrichment.ts` runs `enrichCoverage`, `enrichExportUsage`, `enrichLibraryTags`,
`enrichTestedBy`, `enrichTestNodeTags`, `enrichDocDrift` as separate passes over
`Map<relPath, FileNode>`.~~ Fixed: `enrichLibraryTags` was already inline per-node during parsing.
The other five (each with its own `for (const node of nodes.values())` plus internal per-node
import loops) had no ordering dependency on each other's output, so they were fused into one
exported entry point, `enrichGraph`, called once from `GraphBuilder.build()` in place of the five
separate calls. Each original function is kept as a standalone export (backed by the same
extracted per-node/per-import helpers `enrichGraph` calls, so there's one implementation of every
rule, not two) — useful for targeted testing. `enrichment.test.ts` asserts `enrichGraph` is
output-equivalent to calling the five originals in sequence.

Measured with a synthetic-graph benchmark (not checked in — throwaway `tsx` script): at 10k nodes,
fused vs. five-separate averaged ~2x faster (7.9ms → 4.0ms); at 1k nodes ~1.2x. Confirms the "measure
first" guidance below was worth following — the win grows with graph size as expected for reducing
`O(n)` passes.

As a side effect, `enrichGraph` also fixed a related correctness bug: on incremental rebuilds,
`GraphBuilder`'s per-node cache reuse shallow-copies nodes from the previous graph, so
`testedBy`/`documentedBy`/`staleFor`/enrichment-added tags were the *same array references*
carried forward build-to-build — enrichment only ever appended, so a relationship that stopped
being true (e.g. a test that no longer imports a file) never got removed. `enrichGraph` resets
these fields before each recompute. See `docs/architecture.md`'s Enrichment section.

## 2. `find_duplicates` on first call still tokenizes cold

ADR-014/015 already solved matching complexity (suffix array, O(n log n)) and repeat-call cost
(per-session token cache keyed by mtime/size). The remaining cost is the **first** call on a
large repo — full tokenization of every candidate file before any result returns. **Action:**
expose progress notifications (ties into the MCP-tools plan's progress-token workstream) so a
long first call isn't perceived as a hang; and/or persist the token cache to disk (like the CLI's
graph disk cache in `src/cli/graph-loader.ts`) so a fresh MCP session doesn't start cold either.

## 3. `get_affected` cache build cost is hidden until first `cached: true` call

`buildChangeImpactCache()` builds an O(1)-lookup structure lazily on first use per
`docs/mcp.md`. Worth confirming whether repeated `analyze` calls (incremental rebuilds) properly
invalidate/rebuild this cache rather than serving stale impact data — if the cache isn't tied to
the same dirty-tracking as `SessionState.dirtyRoots`, a stale `cached: true` result is a
correctness bug disguised as a performance feature. **Action:** trace `changeImpactCaches`
lifecycle in `src/mcp/cache.ts` against `dirtyRoots` invalidation; write a regression test if the
two aren't coupled.

## 4. Disk cache (CLI) vs. session cache (MCP) are two independent cache designs

`src/cli/graph-loader.ts` has its own disk-backed cache; `src/mcp/cache.ts` has its own in-memory
session cache. Both re-implement "is this graph still valid" logic independently. **Action (low
priority, mostly a maintenance win, not a perf win):** consider whether the CLI's disk cache
could seed the MCP server's first `analyze` call in a given session (skip cold parse entirely
when a valid on-disk cache already exists for that root), rather than the MCP server always
parsing fresh on session start.

## Suggested order

1. Correctness check on `ChangeImpactCache` invalidation (#3) — do this regardless of whether
   it's fixed, since serving stale data silently is worse than being slow.
2. Everything else (#1, #2, #4) — measure-first, pursue only where profiling shows real cost.

The worker-pool threshold regression (`DEFAULT_MIN_FILES_FOR_POOL`) is no longer tracked here —
it was fixed directly in `src/graph/builder.ts` (raised to 600; see `project_worker_pool_threshold.md`).

Resolver specifier-resolution caching (formerly tracked here as item #1) is no longer tracked —
it was implemented directly in `src/graph/resolver.ts` (per-build `resolutionCache` on
`DefaultResolver`, keyed by importer directory + lang-resolver bucket + specifier, with
negative-result caching).

## What NOT to do

Don't reach for a rewrite of the resolver or a switch to a different parsing backend (e.g. from
the TS compiler API) speculatively — `project_ts7_compiler_api_risk.md` already flags that
TypeScript 7's native-compiler API isn't ready to build against yet. Perf work here should stay
inside the current architecture (caching, batching, thresholds), not a platform swap.