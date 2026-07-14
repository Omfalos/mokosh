# ADR-010: Worker-Pool Parallel Parsing

**Date:** 2026-07-14
**Status:** Accepted

---

## Context

`GraphBuilder.build()` (`src/graph/builder.ts`) walks the file system from entry points, parsing every reachable file and resolving its imports to discover more files. This was fully single-threaded: every `parseFile()` call (`src/parser.ts`) ran in-process, one file at a time — TypeScript/JS via the `typescript` compiler API is the known CPU-heavy path, with Python (`@lezer/python`) and Go (`@lezer/go`) also non-trivial. On large repos this makes `analyze` (MCP) and CLI builds slow.

The traversal is inherently discovery-driven: a file's children are only known once it's been parsed. This rules out naively spawning a process per file up front — the file set isn't known ahead of time, and the shared `visited` set / incremental mtime+size cache would be hard to split across processes without a much larger rewrite.

---

## Decision

Offload just the CPU-heavy `parseFile()` call to a `piscina` (`worker_threads`) pool, while keeping traversal, resolution, and the `visited`/incremental-cache bookkeeping on the main thread.

This required restructuring `GraphBuilder`'s traversal from a recursive depth-first walk (`resolveImports` recursively `await`ing `processFile` on each local import) into a queue-pumped wavefront: `discover`/`enqueue` still runs synchronously on the main thread (race-free dedup), but each round parses every currently-queued file **in parallel** via `Promise.all`, dispatching each parse to the pool. Files discovered during a round join the next round's queue. Traversal order is no longer strict DFS — nothing downstream depends on discovery order (confirmed: `computeGraphHash` in `src/graph/change-impact-cache.ts` already sorts nodes before hashing, so incremental-cache invalidation is unaffected by the reordering).

The worker entry (`src/parse-worker.ts`) is a thin wrapper that calls `parseFile()` and returns the plain-data `ParseResult` — verified structured-clone-safe (no class instances, functions, or `ts.SourceFile` leak across the boundary; that only lives in the separate `ParseContext` type). It builds to `dist/parse-worker.js`/`.mjs` as its own tsup entry, deliberately placed at the top level of `src/` (not nested under `src/graph/`) so its build output lands at the same `dist/` directory level as `index.js` — `GraphBuilder` locates it via `path.join(__dirname, "parse-worker.js")`, and since `builder.ts` is bundled *into* `index.js`, `__dirname` at runtime resolves to `dist/`, not `dist/graph/`. A worker file nested in a subdirectory would silently break this path.

Gating: a pool is only constructed once a cheap pre-scan of `rootDir` (capped early, not exhaustive) finds at least `minFiles` files (default 20), and only for builds where `parallelParsing` isn't explicitly disabled. Pool construction is wrapped in try/catch — a spawn failure (e.g. a sandboxed environment without `worker_threads` permission) falls back to synchronous in-process parsing for the whole build rather than failing it. The pool is created and torn down (`pool.destroy()`) once per `build()` call.

---

## Options considered

### 1. `child_process` per file — rejected

The user's original idea. Rejected because the file set to process isn't known until traversal happens (a file's imports are discovered by parsing it), and `visited`/incremental-cache state would need cross-process coordination for no clear benefit over threads for this workload (structured-cloneable, no native addons involved).

### 2. Full process-per-subtree split — rejected

Partition entry points across `child_process` workers, each running its own `GraphBuilder`, merging results. Higher theoretical ceiling but requires solving cross-subtree dedup and incremental-cache sharing across processes — much more invasive for a workload where the actual bottleneck (per-file parsing) doesn't need process isolation.

### 3. Worker-thread pool for `parseFile()` only, via `piscina` — **chosen**

Narrowest change that targets the actual CPU cost (parsing) without touching the parts of the build that depend on shared, ordered state (traversal, resolution, caching). `piscina` was chosen over hand-rolling a `worker_threads` pool manager for battle-tested queueing/backpressure/worker-recycling.

---

## Consequences

**Positive**
- Real speedup for repos with large individual files or enough total files — e.g. 3000 moderate-size files: ~2.9s sync vs ~1.3s pooled (measured on this repo's synthetic benchmark fixtures); 40 files with heavy per-file complexity (3000 functions each): ~3.2s sync vs ~1.7s pooled.
- No change to build *correctness* — pooled and synchronous builds produce identical graphs (verified by an order-normalized equivalence test comparing `parallelParsing: false` against a forced pool run).
- Graceful degradation: small builds and spawn failures both fall back to the exact synchronous path that existed before this change.

**Negative — the threshold tradeoff is the main risk of this ADR**
- Each worker thread pays a one-time ~136ms cost to load the worker bundle (it pulls in the TypeScript compiler, lezer parsers, postcss, etc.) before doing any real work, and the pool is rebuilt from scratch on every `build()` call rather than kept warm across repeated calls (relevant for the MCP server, which is long-lived and calls `analyze` repeatedly). `parseFile()` itself is fast enough for typical files — sub-millisecond to a few milliseconds via `ts.createSourceFile`, not a full type-checked `Program` — that this warm-up cost dominates below a real, measured **crossover point of roughly 600-700 files** (for moderate ~30-line files; fewer if files are individually heavy, since total parse cost — not raw file count — is what actually matters and file count is only a cheap proxy for it).
- The shipped default (`minFiles: 20`) is well below that crossover. This repo's own 223 files regress from ~150-220ms (sync) to ~1.6-1.8s (pooled) under the default — an ~8x slowdown for a typical small/medium repo. This was measured and shown to the user, who explicitly chose to keep the low default anyway: mokosh's own build stays acceptably fast either way, and the stated goal is making large repos faster, accepting the small-repo tradeoff rather than tuning the threshold or defaulting to off.
- Because the tradeoff is real, `parallelParsing` is exposed as a config option (`MokoshConfig.parallelParsing` in `mokosh.config.*`, also settable programmatically via `createImportMap`/`createWorkspaceGraph` options) so users on small/typical repos can set `false` to always parse in-process, or pass `{ minFiles, maxThreads }` to raise the threshold for their own repo size instead of accepting the default.
- A more thorough fix — keeping the pool warm across the MCP server's session lifetime instead of per-build — would improve the economics substantially for repeated `analyze` calls, but is a larger change deferred as a possible follow-up.
