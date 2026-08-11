
# ADR-013: Reducing Noise in Token-Based Duplicate Detection

**Date:** 2026-08-06 (Phase 2/4 added 2026-08-11)
**Status:** Implemented. CSS/SCSS/Less use a structural comparator (superseding the Phase 1/2
tokenizer-tuning plan below for those three languages). Every other language (including Stylus)
stays on the token-shingle path, now family-partitioned (Phase 1), gated by punctuation density
(Phase 2), and clustered N-way instead of pairwise (Phase 4).

---

## Context

[ADR-012](./adr-012-duplicate-detection.md) chose a language-agnostic token-shingling
pipeline for `findDuplicates` over an AST-fingerprint or wrapped-external-tool approach, and
already named a known trade-off: the shared, cross-language `KEYWORDS` denylist in
`tokenizer.ts` is "deliberately coarse... which very occasionally over-matches."

Manually verifying `--find-duplicates` against SCSS confirmed this is worse than "occasional"
for CSS-family languages specifically. `COMMENT_SYNTAX` already has entries for
`css`/`scss`/`less`/`stylus` and the pipeline runs on them today, but:

- Every identifier-shaped token collapses to a placeholder (`ID`) unless it's in the shared
  `KEYWORDS` list, which is JS/Python/Go-oriented (`if`, `for`, `class`, `def`, …) — it contains
  no CSS property names or value keywords.
- That means `display: flex` and `display: block` tokenize identically (`ID : ID ;`), and two
  unrelated rule blocks with the same declaration *shape* but different selectors, properties,
  and values can register as a "duplicate" even though nothing meaningful was copy-pasted.
- Reproduced live: two SCSS rules with different selectors, sharing only declaration shape,
  were correctly matched by the tool as designed — but that's exactly the false-positive mode
  described above, not a bug in execution.

Since CSS-family declarations carry a small, finite vocabulary (property names, common value
keywords) compared to JS/Python identifiers, they're disproportionately likely to collapse into
indistinguishable `ID` streams under the current one-size-fits-all normalization. Other
languages sharing the same generic tokenizer likely have their own, less-obvious versions of
this problem and haven't been individually audited.

---

## Plan (iterative, language-by-language)

Not committing to all of this at once — each phase should be measured before starting the
next, and phases can be scoped to one language family at a time (starting with CSS/SCSS/
Less/Stylus, since that's the confirmed case).

### Phase 0 — noise benchmark (prerequisite for every later phase)

Add fixtures to `src/graph/duplication/index.test.ts` (or a new file) per language family that
assert both directions:
- known true positives still reported (real copy-paste)
- known near-misses are *not* reported (e.g. a `display:flex` block vs. a `display:block`
  block with otherwise-identical shape should not match)

Without this, later tuning is unverifiable — no way to tell "fewer false positives" from
"different false positives."

### Phase 1 — per-language tokenizer tuning (superseded for CSS/SCSS/Less, see Phase 3′ below)

**Family partitioning: done, still in effect.** `src/graph/duplication/families.ts` maps every
`FileType` into one of two families — `"style"` (currently just Stylus, see Phase 3′) or
`"code"` (everything else) — and `findDuplicates` (`src/graph/duplication/index.ts`) buckets
token-shingled files by family *before* tokenizing, running the shingle/chain-merge pipeline
independently per bucket and tagging each returned `DuplicateGroup` with its `family`. This
still matters for Stylus and for cross-contamination between any two token-shingled languages in
general, even though it's no longer what protects CSS/SCSS/Less (Phase 3′ removed those from the
token-shingle path entirely).

**Superseded, not pursued:** per-`FileType` `KEYWORDS` vocabulary and per-`FileType`
`windowSize`/`minLines` tuning for CSS-family languages. Phase 3′ fixes the same false-positive
case more precisely (exact declaration-content matching, not a better-tuned shape match) and
was cheap enough to do immediately rather than as tokenizer tuning. This tuning may still be
worth doing later for Stylus, which stayed on the token-shingle path.

### Phase 2 — structural noise gates (still lexical, no AST)

Generic, language-agnostic additions to `shingle.ts`, for the token-shingled languages that
remain (Stylus and the `code` family) — TS/JS, Python, Go, CoffeeScript, LiveScript, Lua,
Gherkin, Markdown, Stylus:
- A "distinct-token ratio" gate — reject windows where too high a fraction of tokens collapsed
  to `ID`/`NUM`/`STR` placeholders (mostly shape, barely any literal content).
- Revisit the `ignoreLiterals` default per language.

Not started.

### Phase 3′ — structural rule-body comparator for CSS/SCSS/Less: **done**

Rather than tuning the token-shingle pipeline's vocabulary for CSS specifically (original
Phase 1 plan), CSS/SCSS/Less moved off it entirely. `src/graph/duplication/style-blocks.ts`
(`findStyleBlockDuplicates`) reuses the PostCSS ASTs the CSS/Less/SCSS parsers already build
(`src/parser/style/css.ts`, `scss.ts`) — no new parsing dependency — and walks every `rule` node
(including nested ones, e.g. inside `@media` or SCSS nesting) to extract its declaration body: an
ordered list of `property: value` pairs, normalized only for incidental whitespace. Two rules are
a duplicate when that body is identical, regardless of their selectors. This fixes the original
false-positive case directly — `display: flex` and `display: block` are different declaration
content, not just "the same shape," so they never match — and is strictly more precise than any
achievable tokenizer tuning, since it compares what was actually written rather than a
placeholder-collapsed approximation of it. `src/graph/duplication/index.ts` routes CSS/SCSS/Less
files here and everything else (including Stylus, which has no shared PostCSS AST in this
codebase) through the token-shingle path as before. Covered by
`src/graph/duplication/style-blocks.test.ts` (different-selector/same-body match,
same-shape/different-value non-match, nested-rule matching, whitespace-insensitivity,
`minDeclarations` gating) and an integration test in `index.test.ts`.

This is effectively an early, narrowly-scoped instance of what the original ADR called
"Phase 3" (reuse existing ASTs) — done for CSS/SCSS/Less first, since mokosh already parses them
with PostCSS for import-edge extraction, well before TS/JS/Python/Go structural comparison (the
original Phase 3 scope) was attempted.

### Phase 4 — n-way clustering: **done**

ADR-012 flagged pair-based (not n-way) reporting as worth revisiting "if pair-explosion turns out
to matter in practice on a real codebase with widespread duplication." It did: dogfooding
`find_duplicates` against mokosh's own repo showed `src/mcp/handlers.test.ts`'s repeated test-setup
blocks alone producing dozens of near-identical overlapping pairs (C(N,2) for a block repeated N
times), crowding out everything else within the default `limit: 50`.

Promoted ahead of Phase 2 and implemented in `src/graph/duplication/shingle.ts`
(`findDuplicateGroups`): pairwise chain-matching still runs exactly as before (unchanged — every
pair's own maximal chain-extended length is computed independently, same as a pairwise-only
detector would), but pair-matches that share an *exact* occurrence (same file, identical
start/end line on one side) are now merged into a single `DuplicateGroup` with N occurrences,
instead of one group per pair. `DuplicateGroup.occurrences` changed from a fixed 2-tuple to
`DuplicateOccurrence[]` (2 or more) to carry this.

**A first implementation was wrong and is worth recording.** The initial version unioned any two
locations that pairwise chain-matched, transitively (standard union-find), and reported the
*minimum* chain length found across the whole connected component — reasoning that token equality
is transitive, so that bound is technically valid for every member. It is valid, but it throws
away information: a file can have one long, genuine match with a second file *and*, separately, a
much shorter incidental match with a third file (an internally-repeated sub-pattern, e.g. one row
of a table-driven test). Transitively unioning both into one cluster reported the entire cluster
at the *shortest* edge's length — verified on this repo's own real `go.complexity.test.ts` ↔
`python.complexity.test.ts` match: a genuine 66-line duplicate was silently reported as 6 lines
because it got merged with unrelated short shingle sub-matches. Switched to clustering only on
exact shared occurrences instead (described above), which merges the pair-explosion case (the
same repeated-boilerplate location matched against several others shares an identical span across
those pair-matches) without ever conflating two matches that merely overlap loosely. Regression
tests for both the fix and the bug it replaces are in `shingle.test.ts`.

### Phase 2 — structural noise gates: **done, redesigned mid-flight**

Implemented as `maxPunctuationRatio` in `findDuplicateGroups`/`findDuplicates` (default 0.5):
gates out token-shingle blocks whose window is mostly object/array-literal structural punctuation
(`{ } : , [ ]`) rather than substantive content — the real motivating case being MCP tool
`inputSchema` boilerplate in `src/mcp/tools.ts`, which was pairwise-matching across ~20 unrelated
tool definitions purely on shared JSON-schema shape.

**The originally-planned metric (distinct-token ratio — reject windows where too high a fraction
of tokens collapsed to `ID`/`NUM`/`STR` placeholders) was tried first and empirically falsified**
against this repo's own code before shipping: it also rejected the genuine
`go.complexity.test.ts` ↔ `python.complexity.test.ts` 66-line match (unique-token ratio ~0.047),
because table-driven test fixtures are just as token-repetitive as schema boilerplate — the
premise that "low identifier diversity ⇒ boilerplate, not real duplication" doesn't hold; both
real dupes and schema noise can be lexically repetitive for unrelated reasons. Measured
punctuation density directly instead, which does separate the two cleanly on real data from this
codebase: ~0.60–0.74 for schema-boilerplate blocks in `src/mcp/tools.ts` vs. ~0.07–0.43 for
genuine duplicated logic (including the table-driven test fixtures the first metric broke).
Verified against synthetic fixtures in `shingle.test.ts` and against real MCP-schema-shaped vs.
real-logic fixtures in `index.test.ts`.

Doesn't apply to the CSS/Less/SCSS structural comparator (Phase 3′), which already matches on
literal declaration content rather than a token window.

---

## Next step

CSS/SCSS/Less duplicate detection is structural, pair-explosion is clustered into N-way groups,
and token-shingle blocks dominated by object-literal punctuation are gated — all three verified
against noise found by dogfooding `find_duplicates` on mokosh's own repo. Remaining open work, in
rough priority order:
1. Decide whether Stylus is worth a structural comparator too (it has no PostCSS AST in this
   codebase today — would need either a Stylus-specific AST library or accept it stays
   token-shingled).
2. The original Phase 3 (TS/JS/Python/Go AST-shape comparator) — largest remaining lift, only
   worth scoping if token-shingle false positives in those languages turn out to matter in
   practice beyond what the punctuation gate and family partitioning already catch.
3. `src/mcp/handlers.test.ts` still reports a handful of large clusters of genuinely repeated
   test-setup boilerplate (correctly, not noise) — worth a human look as a "this could be a shared
   test helper" refactor candidate, separate from anything `find_duplicates` itself should change.
