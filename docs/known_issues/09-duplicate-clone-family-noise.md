# Issue 9 — `find_duplicates` reports one row per LCP-tree node instead of per clone family

Status: **fixed, partially** (2026-09-04). Reported by a peer session dogfooding `find_duplicates`
against box-ui-elements (3,480 nodes) with the filters that worked well in an earlier dogfood pass
(`ignoreLiterals:false`, snapshot/test dirs excluded, `minLines:10`).

## Symptom

At `limit:50` the real cross-file signal is stable and useful (~8 findings: `ContentPicker.js` ↔
`ContentExplorer.tsx` hotkey handler, `MetadataQueryAPIHelper` JS/TS port, `TextInput`/`TextArea`,
`ItemIconMonotone`/`ItemIcon`, `OffsetBasedPagination` JS/TS, `APIFactory.js`'s repeated
`getXxxAPI` methods, etc.). At `limit:500` the output is mostly noise, and raising `limit` further
surfaces more of the same noise rather than new signal. Two classes, quoted from the report:

1. **Same-file sliding-window self-overlap.** "Feed.js (21 groups), Metadata.js (13),
   utils/fields.js (12), on top of the previously-known APIFactory.js/box-edit/constants.js/
   README.md. All from the block matcher re-windowing over long lists of similarly-shaped lines
   (object literals, repeated case branches) within one file — same finding, reported dozens of
   times at shifted offsets."
2. **Combinatorial multi-file cluster explosion.** "~35+ of the 500 groups are the *same* 15-25
   unrelated files (box-edit/constants.js, common/types/core.js, ContentExplorer.tsx,
   ContentPicker.js, PillSelectorDropdown.js, EmailForm.js, FileIcon.tsx, utils/fields.js, etc.)
   matching each other with slightly different member subsets each time — looks like one shared
   boilerplate shape (probably a common Flow/TS prop-types or import block) getting
   combinatorially re-reported as many separate 'duplicate groups' instead of one finding."

The user's ask, verbatim: "this is definitely not how i wished for the tool to work, the
duplication is matching too much as duplicate, maybe we need a better way," and "raising `limit`
just surfaces more of this instead of new signal — they want a better mechanism, not a bigger
cap."

## Root cause

Not a bug in the matcher picking wrong matches. `findExactDuplicateGroups`
(`src/graph/duplication/suffix-duplicates.ts`) enumerates *every* node of the LCP-interval tree
([ADR-015](../adr-015-suffix-array-duplicate-detection.md)) that clears `windowSize`/`minLines`/
the punctuation gate, and every node is individually a technically-correct maximal repeat. A
shared boilerplate shape produces a *family* of tree nodes, not one: a shorter interval with more
occurrences (the prefix every copy shares) and one or more longer sibling intervals with fewer
occurrences each (the subsets that extend that prefix further). Reporting the whole family as
separate `DuplicateGroup`s is exactly the "same shape, one row per variant" noise described above.

## Fix

`applyDominanceFilter` (new, `src/graph/duplication/suffix-duplicates.ts`) — a post-processing
pass, longest-match-first, that drops an occurrence once its token-index span is fully contained
in an already-accepted longer match in the same file, and drops a candidate entirely once fewer
than two occurrences survive. See [ADR-015's addendum](../adr-015-suffix-array-duplicate-detection.md)
for the full design, including a correctness detour worth knowing about: a first, per-occurrence
version of this filter was unsound (a randomized differential test caught it — dropping an
occurrence can silently delete the only report of a real file pairing when that occurrence is
spatially subsumed by an *unrelated* longer match). A provably-safe alternative (drop a candidate
only when *every* occurrence is covered by one single already-accepted candidate) was built next
but is close to a no-op in practice — `isLeftMaximal` already excludes the one case it could
safely act on. **The lossy per-occurrence version shipped anyway, deliberately** — verified via a
synthetic probe to meaningfully shrink both reported noise classes (a Feed.js-shaped self-overlap
case went from 7 groups to 2), at the accepted cost that `find_duplicates` can now silently
under-report a rare file pairing. `suffix-duplicates.test.ts`'s differential test was updated to
assert this explicitly (`exactGroups`' pair coverage is now a subset of, not equal to, the
`shingle.ts` ground truth).

## What this does and doesn't fix

- **Fixes:** same-file self-overlap chains and cross-file matches where a shorter match's
  occurrences are a same-starting-position subset of a longer match already found — the literal
  "ancestor/descendant nesting" shape both reported noise classes are substantially made of.
- **Does not fix:** two matches that start at genuinely different positions and merely sit near
  each other (no containment relationship) stay separate, by design — collapsing those would need
  clustering, not filtering. A genuinely branching clone family (a shared prefix that several
  *different*, non-nested subsets of files each extend their own way) still reports one group per
  branch — fewer than the pre-fix explosion, but not collapsed to one.

## Test plan

- `src/graph/duplication/suffix-duplicates.test.ts`: a shorter match fully subsumed by a longer
  one at the same position is dropped (not double-reported); same-file partial-extension repeats
  collapse to the longer match; two genuinely separate (non-containing) matches are both kept, not
  merged; the existing randomized differential test updated to a subset-coverage invariant.
- Regression: the full pre-existing `suffix-duplicates.test.ts` / `index.test.ts` suite passes
  unchanged (128 files / 1519 tests project-wide after this change).

## Remaining scope (deferred, not started)

**Connected-component clustering.** For the cases the containment filter can't touch — a
genuinely branching clone family, or near-duplicates that don't literally nest — group every file
that shares *any* match into one cluster-level finding ("these N files share a boilerplate shape,
M variants, longest match K lines") instead of reporting one row per pairwise/subset variant. This
was considered as the primary fix and set aside in favor of the (much smaller) dominance filter
first, on the reasoning that it's worth confirming how far a pure post-filter gets before taking
on a new result shape. If a follow-up dogfood pass against box-ui-elements at `limit:500` still
shows substantial non-nested cross-file explosion, this is the next lever.

**Not pursued:** the peer session's suggested `"self-overlap"` `DuplicateSignal` — `"same-file"`
(issue 5) already lets a caller filter out every group whose occurrences are all in one file,
which is what that tag would have covered; the actual gap was group *count*, not filterability.

## Files touched

`src/graph/duplication/suffix-duplicates.ts` (the two-pass restructuring +
`applyDominanceFilter`), `src/graph/duplication/suffix-duplicates.test.ts`,
`docs/adr-015-suffix-array-duplicate-detection.md` (addendum).

## Dependencies

Shares `find_duplicates`' result shape with [issue 6](06-duplicates-query-language.md) (query
layer) and [issue 7](07-per-language-analysis-semantics.md) (`kind: "definition"` groups) — this
fix only touches `kind: "block"` (block-matcher) groups, not the definition-level detectors issue
7 shipped. Feeds [issue 8](08-cross-language-reliability.md)'s broader reliability umbrella.
