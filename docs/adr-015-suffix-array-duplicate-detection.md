# ADR-015: Suffix-Array-Based Exact Duplicate Detection

**Date:** 2026-08-11
**Status:** Accepted

---

## Context

ADR-014 fixed `find_duplicates`' large-repo timeout by capping hash-bucket size (`maxBucketSize`)
in the original hash-shingle matcher (`shingle.ts`). That mitigation works, but it's a heuristic
with a real cost: it can silently under-report a legitimately widespread duplicate, and — more to
the point raised in review — the underlying algorithm still has an O(k²) worst case per hash
bucket that the cap merely *bounds*, rather than an algorithm that doesn't have that worst case at
all. A follow-up option considered (parallelizing the matcher itself across worker threads,
sharding by hash bucket) ran into a second, distinct problem: `extendChain`'s forward walk needs
each location's neighboring hashes, not just the hashes in its own bucket, so any worker-sharded
version would need either a bounded, truncatable lookahead per location (another disclosed
approximation) or full inter-worker data sharing (real implementation complexity `piscina`'s task
model doesn't provide for free).

The actual right data structure for "find every maximal repeated substring across many strings,
fast, without quadratic blowup on repetitive input" is well established in the stringology
literature and used by production clone-detection tools (PMD's CPD, CCFinder): a **suffix array**
with its **LCP (longest-common-prefix) array**, enumerated via the **LCP-interval tree** — the
generalized-suffix-tree structure this pair of arrays implicitly encodes.

---

## Decision

Replace `findDuplicates`' matching engine with a suffix-array-based exact matcher
(`suffix-duplicates.ts`), built on two new low-level modules:

- **`suffix-array.ts`** — `buildSuffixArray` (Manber–Myers prefix-doubling, O(n log n)) and
  `buildLcpArray` (Kasai's algorithm, O(n)), operating on the token stream directly (each distinct
  token text is one "character" of the alphabet — no per-character tokenization of source text).
- **`lcp-intervals.ts`** — `buildLcpIntervals`, a monotonic-stack bottom-up traversal
  (Abouelhoda, Kurtz & Ohlebusch, 2004) that enumerates every internal node of the implicit
  generalized suffix tree in O(n) total, without building the tree itself. Each node — an
  `LcpInterval` — is one maximal group of suffix-array positions sharing an exact common prefix
  length; that's one candidate duplicate-code block.
- **`suffix-duplicates.ts`** — orchestrates the above over `findDuplicates`' per-family token
  streams: concatenates every file's tokens with a unique-per-file sentinel between files (so no
  match can span a file boundary — `tokenize()`'s token pattern never produces a token starting
  with whitespace, so a plain space-prefixed sentinel is guaranteed distinct from every real
  token), builds the suffix array / LCP array / interval tree once for the whole family, then
  converts each surviving interval into a `DuplicateGroup` (same shape `shingle.ts` produced).

`shingle.ts` (the original hash-shingle-bucket matcher) is **untouched and still independently
tested** — it's a reasonable, correct implementation on its own terms — but `findDuplicates` no
longer calls it. `maxBucketSize`/`skippedBuckets` are removed from the public
`FindDuplicatesOptions`/`FindDuplicatesResult`, the MCP tool schema, and CLI output, since the new
engine has nothing resembling a hash bucket to cap. See the note under ADR-014 §1.

### Why this needed its own left-maximality filter

A right-maximal LCP interval (one whose `lcpLength` is the true maximal common prefix for its
exact membership — guaranteed by construction) is *not* automatically a non-redundant finding. A
single genuine N-token duplicate also makes every one of its suffixes — (N-1)-token, (N-2)-token,
… — independently "right-maximal" for the same occurrence positions shifted forward by one, two,
… tokens, since those shorter runs are trivially also shared between the same two locations. Left
unfiltered, one real 15-token duplicate reported 11 additional, fully redundant "duplicates" of
lengths 14 down to 5 in testing. The fix is the standard stringology notion of a **maximal
repeat**: an interval is only reported if it's also *left-maximal* — its occurrences do not all
share the same immediately-preceding token (an interval where they do could be extended one token
to the left for every occurrence at once, meaning a longer, equally-valid interval already covers
the same finding). `isLeftMaximal` in `suffix-duplicates.ts` implements this check; a randomized
differential test (`suffix-duplicates.test.ts`) cross-checks the new engine's per-file-pair
coverage against `shingle.ts`'s on hundreds of randomized trials to catch any remaining gap.

### Verification approach

Suffix array / LCP array bugs are notoriously easy to get subtly wrong (off-by-one at file
boundaries, wrong tie-breaking in prefix-doubling, wrong pop condition in the interval stack), so
each layer is tested against an independent ground truth rather than only against itself:

- `suffix-array.test.ts` — the classic "banana" example (hand-verifiable known suffix array
  `[5,3,1,0,4,2]` and LCP array `[0,1,3,0,0,2]`), plus randomized cross-checks against a brute-force
  O(n² log n) reference construction.
- `lcp-intervals.test.ts` — verifies the three known maximal repeats of "banana" (`a`, `ana`, `na`)
  by exact membership, plus a randomized invariant check that every reported interval's members
  truly share its exact reported length (not merely "at least") via brute-force pairwise LCP.
- `suffix-duplicates.test.ts` — every scenario `shingle.test.ts` covers (cross-file matches, exact
  full-length reporting, `minLines`, same-file self-overlap exclusion, N-way clustering,
  structural-punctuation gating) re-run against the new engine, plus the randomized differential
  test against `shingle.ts` described above.

---

## Options considered

### Parallelize the hash-shingle matcher across worker threads, with bounded chain-extension lookahead — rejected

Discussed as the natural next step after ADR-014's bucket cap. Rejected once weighed against the
suffix-array approach: it would have added a second disclosed approximation (a length cap on how
far a match could be found before truncating) on top of the bucket-size cap ADR-014 already
disclosed, for a real implementation cost (worker-sharded bucket dispatch, per-shard lookahead
payloads), and would still leave the underlying algorithm's O(k²)-per-bucket shape in place —
merely spreading it across cores rather than removing it.

### Embedding/similarity-matrix (transformer-style) matching — rejected

Considered and rejected as solving a different problem. A dense pairwise-similarity matrix over
every token window is still O(n²) comparisons — worse than the hash-bucket approach it would
replace, since each comparison is a vector operation instead of a hash-equality check, and would
need an embedding model (a new runtime dependency, non-deterministic/threshold-based output) to
even produce the vectors. It's the right tool for *semantic* similarity (Type-3/4 clones, e.g. a
`for` loop rewritten as `.reduce()`), a genuinely different feature from what `find_duplicates`
does today, not a faster version of the exact/near-exact matching it already provides.

### AST-fingerprint matching — rejected (reaffirms ADR-012)

Not revisited here; ADR-012's original reasoning stands. A suffix array over tokens keeps the
"works uniformly across every `FileType`, including ones with no AST-level parser support" property
that ruled out AST fingerprinting in the first place — this ADR only changes the matching
algorithm underneath the same token-based approach, not the tokenization strategy.

---

## Consequences

**Positive**
- No pathological worst case: matching is O(n log n) / O(n) in total token count, full stop —
  independent of how common any single token pattern is. The problem ADR-014's bucket cap merely
  *bounded* is now structurally absent.
- Every reported match is exact and complete — no chain-extension lookahead, no truncation, no
  disclosed false-negative risk to reason about. `maxBucketSize`/`skippedBuckets` are gone because
  there's nothing left for them to guard against.
- `shingle.ts` remains available, correct, and tested, in case a future need re-motivates
  comparing against it (e.g. a benchmark, or a case where its different tie-breaking/nesting
  behavior turns out to be preferable for some use).

**Negative**
- Another breaking change to `FindDuplicatesOptions`/`FindDuplicatesResult` (removes
  `maxBucketSize`/`skippedBuckets`, following the `groups`-array → `{ groups }` shape change from
  ADR-014) — the second breaking change to this API in short succession. Both MCP tool and CLI
  output are updated as part of this change; any other direct library consumer needs to drop those
  fields.
- Real implementation complexity: two new low-level modules (suffix array, LCP-interval tree) most
  contributors won't have direct prior familiarity with, versus the more approachable
  hash-and-compare shape `shingle.ts` had. Mitigated by the layered, independently-tested-against-
  ground-truth verification approach described above, and by keeping `shingle.ts` around as a
  simpler reference implementation of the same contract.
- Construction is O(n log n) rather than a tighter O(n) suffix-array construction (SA-IS, DC3) —
  chosen deliberately for implementation simplicity and lower bug risk over asymptotically optimal
  but substantially more intricate algorithms; worth revisiting only if profiling on a real large
  repo shows suffix-array construction itself as the bottleneck, which is not expected at realistic
  per-family token-stream sizes.