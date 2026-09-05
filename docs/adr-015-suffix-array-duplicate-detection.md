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

---

## Addendum (2026-09-04): clone-family consolidation (`applyDominanceFilter`)

**Status:** Implemented. See docs/known_issues/09-duplicate-clone-family-noise.md for the
dogfooding report this responds to.

### Problem

A shared boilerplate shape doesn't produce one LCP-interval-tree node, it produces a *family* of
them: a shorter interval with more occurrences (the prefix every copy shares) and one or more
longer sibling intervals with fewer occurrences each (the subsets that extend that prefix
further). Every node is individually a valid maximal repeat by this ADR's own design — that's
working as intended — but `findExactDuplicateGroups` reported every qualifying node as its own
`DuplicateGroup`, which dogfooding against box-ui-elements (3,480 nodes) showed compounds badly on
real repetitive code: a repeated internal shape in one file reported dozens of times at shifted
offsets/lengths, and a common shared import/prop-types block reported as ~35+ separate groups
across the same ~15-25 files with slightly different member subsets each time. Raising `limit`
surfaced more of this, not more signal.

### Decision, and the correctness detour that shaped it

The fix (`applyDominanceFilter` in `suffix-duplicates.ts`) restructures `findExactDuplicateGroups`
into two passes: per-interval candidate extraction (the same gates `groupFromInterval` always
ran — `windowSize`, `isLeftMaximal`, `dropSelfOverlaps`, punctuation, `minLines`), then a global
pass across every surviving candidate, longest-`lcpLength`-first, that drops an occurrence when
its `[start, start+length)` span is fully contained in an already-accepted (longer, or
equal-and-earlier) span in that same file; a candidate left with fewer than two surviving
occurrences is dropped.

**A first version of this filter was unsound, and a randomized differential test caught it**
before it shipped (the same `suffix-duplicates.test.ts` vs. `shingle.ts` cross-check this ADR's
main text describes) — worth recording since the failure mode is subtle. That version is the one
above; the bug is real: dropping an occurrence purely because its *span* is subsumed elsewhere
ignores *which other files* the subsuming match involves. If file A shares code with file D only
via this exact candidate, and D's occurrence in it happens to be spatially contained in an
unrelated longer match between files B and C, trimming D out of the A↔D group silently deletes
the only report of that pairing — a real regression in what `find_duplicates` promises, not a
tuning knob.

A provably-safe alternative was designed and implemented next: drop a candidate only in its
entirety, and only when *every* one of its occurrences is covered by the *same single*
already-accepted candidate (never a union of several) — since that candidate's whole occurrence
set was itself accepted intact, every pairwise relationship the redundant candidate could report
is already present in it. This is provably lossless. **It was also, empirically, close to a
no-op**: `isLeftMaximal` already excludes the one case (a shorter candidate with an *identical*
occurrence set to a longer one) this stricter filter could safely act on without risking the bug
above, so on both a synthetic probe mirroring the reported Feed.js self-overlap pattern and by
construction, it left the actual reported noise — near-duplicate, non-identically-positioned
matches, and genuinely branching clone families — essentially untouched.

**Decision: ship the lossy per-occurrence version anyway, deliberately, not the provably-safe
one.** Verified against the same synthetic probe, it cut the Feed.js-shaped case from 7 groups to
2 and correctly collapsed nested cross-file cases to their most specific match. The completeness
gap is real and now permanently encoded rather than accidental: the differential test in
`suffix-duplicates.test.ts` was changed from asserting `exactGroups`' file-pair coverage exactly
equals `shingle.ts`'s ground truth to asserting only that every pair `exactGroups` reports is also
one `shingle.ts` would report (i.e. `exactGroups` can now be a strict subset, never a superset) —
this is the explicit, permanent contract change this addendum makes, not an incidental side
effect.

### Consequences

**Positive**
- Meaningfully fewer redundant groups on real repetitive code (same-file self-overlap chains,
  simple ancestor/descendant nesting) without touching `windowSize`/`minLines`/
  `maxPunctuationRatio`/`isLeftMaximal`/`dropSelfOverlaps` semantics or the suffix array / LCP
  array / interval-tree construction itself.
- `O(m log m)`-shaped (`m` = total surviving-occurrence count, bounded by the token stream length
  like everything else in this pipeline) — no new complexity class, no reintroduction of the
  `O(k²)`-per-bucket shape ADR-014/015 replaced.

**Negative — accepted deliberately, not an oversight**
- `find_duplicates` can now silently under-report: a real file-pairing can go unreported when its
  only representative occurrence is spatially subsumed by an unrelated, larger match. No new
  `DuplicateSignal` marks when this happened to a given result, since the pairing that would need
  one is exactly the one that's missing.
- Does **not** fix the harder case reported alongside the self-overlap noise: genuinely branching
  clone families (a shared prefix that different, non-nested subsets of files extend in different
  ways) and non-nested near-duplicates (similar but not literally overlapping-in-token-index
  matches) pass through unchanged, since neither has the "same starting position, different
  length" structure this filter can act on at all. **Addressed separately, additively:**
  `src/graph/duplication/clusters.ts` (2026-09-05) buckets `groups` by *exact* occurrence file-set
  equality into a new `clusters` field on `FindDuplicatesResult`, rather than trying to make this
  filter drop more. A first version clustered by connected file-component (transitively) instead
  and had to be corrected the same day — see docs/known_issues/09-duplicate-clone-family-noise.md
  for why that chains into meaningless superclusters on real repos.