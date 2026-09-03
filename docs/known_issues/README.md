# Known issues

Point-in-time issue write-ups from dogfooding mokosh v0.5.0 against real Java/Kotlin/Scala
monorepos and against mokosh itself (2026-09-03). Each file is a self-contained plan:
symptom, root cause with `file:line` references, fix, test plan, and cross-issue
dependencies.

| # | File | Symptom |
|---|------|---------|
| 1 | [`01-monorepo-workspace-packages-timeout.md`](01-monorepo-workspace-packages-timeout.md) | `get_workspace_packages` times out in MCP clients (Cursor) on monorepos |
| 2 | [`02-monorepo-empty-entrypoints-timeout.md`](02-monorepo-empty-entrypoints-timeout.md) | `analyze` with `entryPoints: []` times out in monorepos |
| 3 | [`03-jvm-cycle-detection-noise.md`](03-jvm-cycle-detection-noise.md) | JVM cycle detection is noise: whole packages flagged as cycles, "app depends on its own tests" |
| 4 | [`04-java-generics-call-edges.md`](04-java-generics-call-edges.md) | Java generics drop call edges (`new Foo<T>()`), breaking `get_call_graph` / `get_callers` |
| 5 | [`05-find-duplicates-and-cycles-noise.md`](05-find-duplicates-and-cycles-noise.md) | `find_duplicates` and `cycles` bury real findings under false positives (docs reported as cycles, generated code as duplicates) |
| 6 | [`06-duplicates-query-language.md`](06-duplicates-query-language.md) | `find_duplicates` output is too large for an LLM to consume; needs a `key:value` query/slim/summary layer |
| 7 | [`07-per-language-analysis-semantics.md`](07-per-language-analysis-semantics.md) | Analyses treat every language like JS/TS; CSS vars, identical TS types, JVM data shapes go undetected |
| 8 | [`08-cross-language-reliability.md`](08-cross-language-reliability.md) | Umbrella: uneven, undocumented feature parity across the 12 supported languages |

## Shared root causes

- **Issues 1 & 2** are the same build path (`createWorkspaceGraph`) hitting the MCP call
  timeout from two entry tools — fix together.
- **Issues 1/2 and 3** both depend on redesigning the **JVM package index**
  (`src/graph/lang-resolvers/jvm.ts`) to be partitioned by module + source root: fixes the
  cycle noise *and* lets one index be shared across the workspace build.
- **Issues 3 and 5** both need **edge-kind-aware `findCycles`** — issue 3 adds
  `isSamePackage`, issue 5 adds `isDocReference` and skips both by default.
- **Issues 5, 6 and 7** all touch the `find_duplicates` result shape: issue 5 adds
  `signals` per group, issue 7 adds `kind: "definition"` groups, issue 6 adds the query
  layer that filters on both. Coordinate the `DuplicateGroup` type change once.
- **Issue 8** is the umbrella: issues 3, 4, 5, 7 are instances of "one language's semantics
  weren't handled". Its conformance harness is what keeps the fixes from regressing.

## Suggested order

1. **Issue 4** — isolated, small, no dependencies.
2. **Issue 3** — introduces the partitioned package index + `isSamePackage` edge flag.
3. **Issue 5** — edge-kind-aware cycles (reuses issue 3's flag) + generated-code filtering;
   lands the `DuplicateGroup.signals` field.
4. **Issue 7** — per-language definition extractors; lands `kind: "definition"` groups.
5. **Issue 6** — the duplicate-results query DSL, on top of 5's `signals` and 7's `kind`.
6. **Issues 1 + 2** — workspace perf, on top of issue 3's index.
7. **Issue 8** — parity matrix + conformance snapshots to lock all of the above in, then the
   remaining language gaps (Kotlin call edges, Groovy, Lua).
