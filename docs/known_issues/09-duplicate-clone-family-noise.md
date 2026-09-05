# Issue 9 — `find_duplicates` reports one row per LCP-tree node instead of per clone family

Status: **fixed** (2026-09-04 dominance filter; 2026-09-05 exact-file-set clustering; 2026-09-05
SVG noise — see the "SVG noise" section below). Reported by a peer session dogfooding
`find_duplicates`
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

## Remaining scope

**Clustering by exact file set: done (2026-09-05, corrected same day).**
`buildDuplicateClusters` (`src/graph/duplication/clusters.ts`) buckets every `DuplicateGroup` into
a `DuplicateCluster` — and `findDuplicates`'s result gains a `clusters` field alongside the
unchanged `groups`. This is the case the dominance filter explicitly couldn't touch: two matches
that start at genuinely different positions with no containment relationship (the
`ContentExplorer.tsx`↔`ContentPicker.js` case reported as 14 separate groups) now report as one
cluster with `matchCount: 14`, `files: [ "ContentExplorer.tsx", "ContentPicker.js" ]`.

**A first version clustered by connected file-component (union-find: any two files that co-occur
in *any* group are connected, transitively) and that was wrong** — caught by a follow-up dogfood
pass the same day, before anyone relied on it in practice. Connected-component clustering is
single-linkage clustering, which chains: on a real production monorepo, one file sharing a single
incidental block each with dozens of otherwise-unrelated files was enough to transitively merge all
of them into one "cluster" — measured at **803 files and 4,853 groups collapsed into a single
entry**, an order of magnitude past the pre-dominance-filter worst case this whole issue started
from (29 files). Worse than the problem it was meant to fix: a caller could no longer even fall
back to reading `groups`' file pairs to recover what was related, since the cluster view actively
obscured it.

**Fix: cluster by exact occurrence file-set equality instead, no transitivity at all.** A group
over `{A, B}` and a separate group over `{B, C}` land in two different clusters even though both
touch B — B is a genuine bridge (it duplicates code with both A and C), but that says nothing about
whether A and C relate to each other, and merging them anyway is exactly the chaining failure mode
above. This still solves the motivating case (all 14 `ContentExplorer.tsx`/`ContentPicker.js`
matches share the identical two-file occurrence set, so they merge) while making the 803-file
scenario structurally impossible — a hub file sharing 50 different, unrelated blocks with 50
different files now produces 50 separate two-file clusters, not one. Traded away: a genuine N-way
clone family reported as several *different-sized* subset groups (a 3-file match here, a 2-file
subset of it there, rather than one consistent N-way group every time) won't merge into one
cluster under this rule. Accepted deliberately — a conservative under-merge is a far safer default
than the chaining failure mode it replaces, and this case is already rare in practice since
`findExactDuplicateGroups` reports a true N-way match as one N-occurrence group whenever the spans
actually coincide.

Purely additive either way — no group is dropped, reordered, or modified to build a cluster;
`groups` is unchanged and `clusters` is a new field a caller can ignore. Clustered from the full
pre-`limit` group set so a cluster's `matchCount`/`files` aren't shrunk by a cap meant for the flat
list; capped to `limit` clusters itself, largest-`longestMatch`-first. See
`src/graph/duplication/clusters.ts` and its test file (including a regression test for the hub-file
chaining scenario above).

**Not pursued:** the peer session's suggested `"self-overlap"` `DuplicateSignal` — `"same-file"`
(issue 5) already lets a caller filter out every group whose occurrences are all in one file,
which is what that tag would have covered; the actual gap was group *count*, not filterability.

## SVG noise (2026-09-05)

A dogfood pass reported that `groups` was still dominated by SVG, in two distinct mechanisms —
both fixed here:

**1. Raw `.svg` (and other non-code asset) files scanned as source.** `import Icon from
"./x.svg"` resolves to a real `FileNode`: `resolveLocalPath` (`src/graph/resolver.ts`) tries the
bare specifier before appending any extension, so the literal `./x.svg` on disk matches with
`isExternal: false` and gets a node with `type: "unknown"`. `findDuplicates` filtered lock files,
ignored dirs and generated files but not `"unknown"` types, and `tokenize()` has no
comment/import rules for `"unknown"` — it just raw-splits the XML — so an icon set (dozens of
near-identical `<svg><path/></svg>` files) flooded the `"code"` family's suffix array, matching
each other *and* real `.tsx`. **Fix:** `findDuplicates` now drops every `type: "unknown"` node up
front, unconditionally (covers `.svg`, `.json`, images, and `.c`/`.cpp` until a real parser
exists). One-line filter change in `src/graph/duplication/index.ts`.

**2. Inline SVG icon components (`.tsx`/`.jsx`).** Under the default `ignoreLiterals: true`, the
one thing that distinguishes two icons — the `d=` path string, gradient stops, `<feColorMatrix>`
constants — collapses to a `STR`/`NUM` placeholder *before* matching, so two different icon
components share an identical token skeleton (`< ID ID = STR > < ID ID = STR /> …`) that clears
`windowSize`, `minLines`, and `maxPunctuationRatio` (which counts `{ } : , [ ]`, not JSX's
`< > / =`). `jsx-elements.ts` already handles *genuine* byte-identical SVG copy-paste as a
`defKind: "jsxElement"` group, but the block matcher runs over the same files independently and
still fires. **Fix:** a new `signals: ["svg-markup"]` tag + `includeSvgMarkup` opt-in, mirroring
`includeSameFile` exactly. `isSvgMarkupSpan` (`src/graph/duplication/svg-markup.ts`) checks a
group's occurrence spans against the *source text*: if every occurrence is predominantly markup
lines and at least one carries an SVG-specific tag/attribute, the group is tagged and excluded
from `groups`/`clusters` by default. Applies to `defKind: "jsxElement"` definition groups too, not
just block matches — a dogfood follow-up found ~65% of the icon noise was `jsxElement` groups on
`<defs>`/`<filter>` blocks shared byte-identically across icons (boilerplate, not an authored
clone). The `jsxElement` detector still produces those groups; `svg-markup` just filters them from
the default view like `same-file` does, recoverable via `includeSvgMarkup`. A non-SVG `jsxElement`
duplicate (`<Card><CardHeader/>…`) is never tagged — the check requires an actual SVG tag/attr.
Per-file-type `ignoreLiterals` was considered and rejected: it breaks the single shared
suffix-array stream and the token cache's one-bool key.

**Files touched:** `src/graph/duplication/svg-markup.ts` (new) + `svg-markup.test.ts` (new),
`src/graph/duplication/index.ts` (`"unknown"` filter, `includeSvgMarkup`, `svg-markup` tagging),
`src/graph/duplication/shingle.ts` (`DuplicateSignal`), `src/graph/duplication/index.test.ts`,
`src/config.ts`, `src/cli/args.ts` + `runner.ts` + `help.ts` + `commands/{types,find-duplicates}.ts`
(+ test fixtures), `src/mcp/{handlers,tools}.ts`, `docs/mcp.md`.

## Files touched

`src/graph/duplication/suffix-duplicates.ts` (the two-pass restructuring +
`applyDominanceFilter`), `src/graph/duplication/suffix-duplicates.test.ts`,
`docs/adr-015-suffix-array-duplicate-detection.md` (addendum). Clustering follow-up:
`src/graph/duplication/clusters.ts` (new), `src/graph/duplication/clusters.test.ts` (new),
`src/graph/duplication/index.ts` (`FindDuplicatesResult.clusters`), `src/cli/commands/
find-duplicates.ts`, `src/mcp/handlers.ts` (`handleFindDuplicates`), `src/mcp/tools.ts`,
`docs/mcp.md`.

## Dependencies

Shares `find_duplicates`' result shape with [issue 6](06-duplicates-query-language.md) (query
layer) and [issue 7](07-per-language-analysis-semantics.md) (`kind: "definition"` groups) — this
fix only touches `kind: "block"` (block-matcher) groups, not the definition-level detectors issue
7 shipped. Feeds [issue 8](08-cross-language-reliability.md)'s broader reliability umbrella.
