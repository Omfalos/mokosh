# Known issues

Point-in-time issue write-ups from dogfooding mokosh v0.5.0 against real Java/Kotlin/Scala
monorepos and against mokosh itself (2026-09-03). Each file is a self-contained plan:
symptom, root cause with `file:line` references, fix, test plan, and cross-issue
dependencies.

| # | File | Symptom |
|---|------|---------|
| 6 | [`06-duplicates-query-language.md`](06-duplicates-query-language.md) | `find_duplicates` output is too large for an LLM to consume; needs a `key:value` query/slim/summary layer |
| 7 | [`07-per-language-analysis-semantics.md`](07-per-language-analysis-semantics.md) | Analyses treat every language like JS/TS; JVM data shapes, idiom exclusion, and the per-language config surface still go undetected/unbuilt (CSS vars + TS types shipped in phase 1) |
| 8 | [`08-cross-language-reliability.md`](08-cross-language-reliability.md) | Umbrella: uneven, undocumented feature parity across the 12 supported languages |

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

## Shared root causes

- **Issues 6 and 7** both touch the `find_duplicates` result shape: issue 5 (fixed) added
  `signals` per group, issue 7 phase 1 added `kind: "definition"`/`defKind` (both fields already
  in place, per `family`/`signals`), issue 6 adds the query layer that filters on all of them.
- **Issue 8** is the umbrella: issue 7 is an instance of "one language's semantics
  weren't handled" (issue 5, fixed, was another; issue 7's CSS/TS slice, also fixed). Its
  conformance harness is what keeps the fixes from regressing.

## Suggested order

1. ~~**Issue 7** — per-language definition extractors; lands `kind: "definition"` groups.~~
   **Phase 1 done** (CSS vars + TS types); JVM/Go/Python + 7c/7d remain.
2. **Issue 6** — the duplicate-results query DSL, on top of issue 5's `signals` and 7's `kind`.
3. **Issue 8** — parity matrix + conformance snapshots to lock all of the above in, then the
   remaining language gaps (Kotlin call edges, Groovy, Lua) and issue 7's remaining languages.
