# ADR-014: Duplicate Detection at Scale

**Date:** 2026-08-11
**Status:** Accepted

---

## Context

`find_duplicates` (`src/graph/duplication/index.ts`, MCP tool and CLI command, ADR-012/ADR-013)
timed out on large repositories. Two separate costs are involved:

1. **Tokenizing.** Every candidate file is read and run through `tokenize()`
   (`src/graph/duplication/tokenizer.ts`) synchronously, in-process, before any matching happens.
   On a repo with many thousands of files this is real, non-trivial CPU work done serially on the
   main thread — the same category of cost `GraphBuilder.parseFile()` already offloads to a
   worker pool per ADR-010.
2. **Shingle matching.** `findDuplicateGroups` (`src/graph/duplication/shingle.ts`) hashes every
   `windowSize`-token sliding window per file into buckets keyed by hash, then does an O(k²)
   pairwise comparison within each bucket of `k` matching locations. This is the dominant cost,
   and it isn't merely large — it can be *pathological*. A single sufficiently common token
   window (a boilerplate header, a common import line, a repeated call pattern) produces a bucket
   whose size scales with total repo size, not with genuine duplication. On a large enough repo, a
   handful of such buckets is enough to make the scan effectively never finish inside an MCP
   client's response timeout — no amount of parallelism fixes an algorithm whose per-bucket cost
   is quadratic in a quantity that itself grows with repo size.

---

## Decision

Two independent changes, addressing each cost separately:

### 1. Cap hash-bucket size (`maxBucketSize`, default 400)

`findDuplicateGroups` now skips a bucket's pairwise comparison entirely once it holds more than
`maxBucketSize` locations, incrementing a `skippedBuckets` counter that's threaded back through
`findDuplicates`' return value (`{ groups, skippedBuckets }`) and exposed by both the MCP tool and
the CLI command. This bounds worst-case scan time independent of repo size.

The tradeoff is real: a bucket this large is overwhelmingly likely to be ubiquitous boilerplate
rather than a single genuine N-way clone (a real clone repeated hundreds of times across a
project is itself unusual), but it's not impossible to under-report a legitimately widespread
duplicate this way. `skippedBuckets` surfaces when the cap fired so callers know results may be
incomplete, and it's a plain option (`Infinity` disables it) for anyone who needs an exhaustive
scan on a repo they know is small enough to afford one.

This is the same class of heuristic as `maxPunctuationRatio` (ADR-013) — trading a small,
disclosed false-negative risk for the scan finishing at all — but applied before chain-extension
runs, since chain-extension and the punctuation-ratio gate are themselves O(k²)-bucket-sized costs
that a pathological bucket would blow through before ever reaching them.

### 2. Offload tokenizing to a worker pool (`parallelTokenizing`, default on)

`findDuplicates` gained the same `piscina` worker-pool pattern `GraphBuilder` already uses for
`parseFile` (ADR-010): `src/duplication-worker.ts` is a thin wrapper around `tokenize()`, built as
its own tsup entry so `dist/duplication-worker.js` lands next to `dist/index.js` (same `__dirname`
reasoning as `parse-worker.js`). A pool is constructed only once the candidate file count reaches
`minFiles` (default 20, matching `GraphBuilder`'s default and its documented crossover
reasoning — see ADR-010's discussion of pool spin-up cost vs. per-file parse cost), and pool
construction is wrapped in try/catch with a synchronous fallback, identical to the parse pool.

Unlike `GraphBuilder`'s discovery-driven traversal, `findDuplicates` already knows its full
candidate file list up front (it's `graph.nodes`, filtered), so no pre-scan walk is needed to
decide whether to pool — `nodes.length` is enough.

---

## Options considered

### Streaming/paginating results across multiple MCP calls — rejected

Would require the MCP server to hold scan state across calls (a new kind of session state beyond
the existing graph cache) and doesn't address the actual pathological cost (quadratic bucket
comparison) — it would just spread the same eventual timeout across more round-trips.

### Only offloading tokenizing, no bucket cap — rejected

Tokenizing parallelism doesn't touch the dominant cost. A repo whose timeout is caused by one or
two pathological buckets would still time out with tokenizing fully parallelized, just slightly
later.

### Only capping buckets, no worker pool — considered, not sufficient alone

The bucket cap alone fixes the pathological-blowup case, but plain per-file tokenizing cost still
scales linearly with repo size and total file content, and is worth parallelizing on its own
merits for very large repos even without any pathological buckets present — the same rationale
ADR-010 already established for `parseFile`. Shipping both together addresses both costs at their
actual source rather than picking one.

---

## Consequences

**Positive**
- `find_duplicates` scan time is now bounded independent of how common any single token window is
  across the repo, not just how large the repo is overall.
- Large repos get real tokenizing parallelism, following an already-established, already-tested
  pattern (ADR-010) rather than a new one.
- `skippedBuckets` makes the tradeoff visible to callers instead of silently dropping results.

**Negative**
- `findDuplicateGroups`'s and `findDuplicates`' return shapes changed (`DuplicateGroup[]` →
  `{ groups, skippedBuckets }`) — a breaking change for any direct caller of the library API, not
  just the MCP tool/CLI (both updated as part of this change).
- `maxBucketSize`'s default (400) is a heuristic, not derived from a measured crossover point the
  way ADR-010's `minFiles` was — it may need tuning once real large-repo scans are observed.
- The worker pool adds a second `piscina` pool type alongside `parse-worker.ts`; `mokosh.config.*`
  does not yet expose `parallelTokenizing` the way it exposes `parallelParsing` — only the
  MCP-tool/CLI/library-call surface does, for now.