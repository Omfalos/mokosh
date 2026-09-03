# Known issues

Point-in-time issue write-ups from dogfooding mokosh v0.5.0 against real Java/Kotlin/Scala
monorepos and against mokosh itself (2026-09-03). Each file is a self-contained plan:
symptom, root cause with `file:line` references, fix, test plan, and cross-issue
dependencies.

| # | File | Symptom |
|---|------|---------|
| 5 | [`05-find-duplicates-and-cycles-noise.md`](05-find-duplicates-and-cycles-noise.md) | `find_duplicates` and `cycles` bury real findings under false positives (docs reported as cycles, generated code as duplicates) |
| 6 | [`06-duplicates-query-language.md`](06-duplicates-query-language.md) | `find_duplicates` output is too large for an LLM to consume; needs a `key:value` query/slim/summary layer |
| 7 | [`07-per-language-analysis-semantics.md`](07-per-language-analysis-semantics.md) | Analyses treat every language like JS/TS; CSS vars, identical TS types, JVM data shapes go undetected |
| 8 | [`08-cross-language-reliability.md`](08-cross-language-reliability.md) | Umbrella: uneven, undocumented feature parity across the 12 supported languages |

## Fixed

- **Issues 1 & 2** — monorepo `analyze` / `get_workspace_packages` timeout — fixed in #12.
- **Issue 3** — JVM monorepo cycle noise (test files inflate the package index) — fixed in #11.
- **Issue 4** — Java generics drop constructor call edges — fixed in #10.

## Shared root causes

- **Issues 5, 6 and 7** all touch the `find_duplicates` result shape: issue 5 adds
  `signals` per group, issue 7 adds `kind: "definition"` groups, issue 6 adds the query
  layer that filters on both. Coordinate the `DuplicateGroup` type change once.
- **Issue 5** also needs **edge-kind-aware `findCycles`**: it adds `isDocReference` and
  skips it by default (building on the `isSamePackage` flag landed with issue 3).
- **Issue 8** is the umbrella: issues 5 and 7 are instances of "one language's semantics
  weren't handled". Its conformance harness is what keeps the fixes from regressing.

## Suggested order

1. **Issue 5** — edge-kind-aware cycles (reuses issue 3's `isSamePackage` flag) +
   generated-code filtering; lands the `DuplicateGroup.signals` field.
2. **Issue 7** — per-language definition extractors; lands `kind: "definition"` groups.
3. **Issue 6** — the duplicate-results query DSL, on top of 5's `signals` and 7's `kind`.
4. **Issue 8** — parity matrix + conformance snapshots to lock all of the above in, then the
   remaining language gaps (Kotlin call edges, Groovy, Lua).
