# Known issues

Point-in-time issue write-ups from dogfooding mokosh v0.5.0 against real Java/Kotlin/Scala
monorepos and against mokosh itself (2026-09-03). Each file is a self-contained plan:
symptom, root cause with `file:line` references, fix, test plan, and cross-issue
dependencies.

| # | File | Symptom |
|---|------|---------|
| 6 | [`06-duplicates-query-language.md`](06-duplicates-query-language.md) | `find_duplicates` output too large for an LLM. **6a–6c shipped** (`filter` DSL + `slim` + `summary`); 6d (shared shaping layer) and the overlapping-window matcher fix remain |
| 7 | [`07-per-language-analysis-semantics.md`](07-per-language-analysis-semantics.md) | Analyses treat every language like JS/TS; JVM data shapes, idiom exclusion, and the per-language config surface still go undetected/unbuilt (CSS vars + TS types shipped in phase 1) |
| 8 | [`08-cross-language-reliability.md`](08-cross-language-reliability.md) | Umbrella: uneven feature parity across languages. **Parity matrix shipped** (`docs/language-support.md` + `LANGUAGE_FIDELITY` + `analyze` `fidelity`); conformance harness, per-tool caveats, and the language gap-closing (8c/8d) remain |
| 9 | [`09-duplicate-clone-family-noise.md`](09-duplicate-clone-family-noise.md) | `find_duplicates` reports one row per LCP-tree node instead of per clone family; connected-component clustering for the remaining non-nested cases still open (dominance filter shipped) |

## Fixed

- **Issues 1 & 2** — monorepo `analyze` / `get_workspace_packages` timeout — fixed in #12.
- **Issue 3** — JVM monorepo cycle noise (test files inflate the package index) — fixed in #11.
- **Issue 4** — Java generics drop constructor call edges — fixed in #10.
- **Issue 5** — `find_duplicates` / `cycles` noise. `cycles` now skips Markdown doc-reference
  edges by default (`ImportEdge.isDocReference`; `analyze({ cycleKinds: ["docReference"] })` opts
  them back in); `find_duplicates` skips generated / vendored files (`includeGenerated`,
  `duplication.ignoreGlobs`) and masks import blocks before tokenizing, and each group carries an
  advisory `signals` list (`"same-file"`, `"generated"`). The distinct-identifier gate and
  accessor suppression from the write-up were **not** done — see the file for why.
- **Issue 7, phase 1** — `find_duplicates` gained `kind: "definition"` groups: CSS/SCSS/Less
  variable drift/consolidation (`style-vars.ts`) and TypeScript `interface`/`type` structural
  duplicates (`type-defs.ts`) — see [ADR-018](../adr-018-per-language-definition-duplicates.md).
  JVM/Go/Python extractors, the idiom-exclusion registry (7c), and the per-language config surface
  (7d) were **not** done — issue 7 stays open for that remaining scope.
- **Issue 9, partially** — `applyDominanceFilter` consolidates same-position nested/redundant
  matches in `findExactDuplicateGroups`, cutting a Feed.js-shaped self-overlap case from 7 groups
  to 2 in testing — see [ADR-015's addendum](../adr-015-suffix-array-duplicate-detection.md) and
  the file for the correctness detour behind the design (a provably-safe version was built first
  and found to be close to a no-op; the shipped version is a documented, deliberate completeness
  trade-off instead). Genuinely branching / non-nested clone families are **not** collapsed —
  connected-component clustering, deferred, is the next lever if that turns out to still matter.

## Shared root causes

- **Issues 6 and 7** both touch the `find_duplicates` result shape: issue 5 (fixed) added
  `signals` per group, issue 7 phase 1 added `kind: "definition"`/`defKind`, and issue 6 (6a–6c
  shipped) added the `filter` DSL that selects on all of them plus `slim`/`summary`.
- **Issue 8** is the umbrella: issue 7 is an instance of "one language's semantics
  weren't handled" (issue 5, fixed, was another; issue 7's CSS/TS slice, also fixed). Its
  conformance harness is what keeps the fixes from regressing.

## Suggested order

1. ~~**Issue 7** — per-language definition extractors; lands `kind: "definition"` groups.~~
   **Phase 1 done** (CSS vars + TS types); JVM/Go/Python + 7c/7d remain.
2. ~~**Issue 9** — dominance filter for block-matcher clone-family noise.~~ **Dominance filter
   shipped**; connected-component clustering remains if non-nested cross-file noise still matters
   after a follow-up dogfood pass.
3. ~~**Issue 6** — the duplicate-results query DSL, on top of issue 5's `signals`, 7's `kind`, and
   9's (now leaner) group counts.~~ **6a–6c done** (`filter` DSL + `slim` + `summary`); 6d
   (shared shaping layer) deferred.
4. **Issue 8** — ~~parity matrix~~ (**shipped**: `docs/language-support.md` + `LANGUAGE_FIDELITY`
   + `analyze` `fidelity`) + conformance snapshots to lock all of the above in, then the
   remaining language gaps (Kotlin call edges, Groovy, Lua) and issue 7's remaining languages.
