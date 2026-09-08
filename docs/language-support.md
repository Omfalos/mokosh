# Language support matrix

mokosh parses 17 languages, but not to the same depth. This page is the authoritative record of
what each language's analysis actually extracts, so you can tell **before** trusting a result
whether a tool will give call-level precision, degrade to import-level, or find nothing.

The table is generated from `LANGUAGE_FIDELITY` in `src/graph/language-support.ts` and kept in
exact sync with it by a test (`src/graph/language-support.test.ts`) — editing one without the
other fails CI. `analyze` (and `mokosh --graph`) echo the same data per language present in the
graph, under `languageCoverage[].fidelity`.

## Fidelity levels

- **full** — implemented with language-aware handling; results are call/symbol-level accurate.
- **partial** — implemented but known-lossy: index-based resolution, module-level (not
  per-symbol) exports, constructor-only call edges, heuristic categories, or the generic
  cross-language token duplicate pipeline (which works everywhere but has no language semantics).
- **none** — not implemented, or not applicable to the language (e.g. import resolution for
  Gherkin).

## The axes

| Axis | What "full" means |
|---|---|
| Import resolution | Raw import/require specifiers resolve to graph edges with ecosystem-correct rules |
| Export symbols | `FileNode.exports` lists individual named symbols (not just "this module exports something") |
| Import symbols | `ImportEdge.symbols` records which names each import pulls in — needed for `exportUsageRatio` / dead-export analysis |
| Call edges | Function-level `FileNode.callEdges` — powers `get_call_graph` / `get_callers` |
| Complexity | Per-function + file-level cyclomatic and cognitive complexity |
| Category | Accuracy of the `logic` / `ui` / `test` / `config` / `barrel` / `type-only` classification |
| Duplication | `full` = a language-aware structural comparator (CSS family); `partial` = the generic token pipeline; `none` = not scanned |
| Test tags | A framework-aware test-tag strategy exists (not the generic path-glob fallback) |

## Matrix

| Language | Import resolution | Export symbols | Import symbols | Call edges | Complexity | Category | Duplication | Test tags |
|---|---|---|---|---|---|---|---|---|
| `typescript` | full | full | full | full | full | full | partial | full |
| `javascript` | full | full | full | full | full | full | partial | full |
| `python` | full | partial | partial | full | full | partial | partial | full |
| `go` | full | partial | none | full | full | partial | partial | full |
| `java` | partial | partial | none | partial | full | partial | partial | full |
| `kotlin` | partial | partial | none | none | none | partial | partial | none |
| `scala` | partial | partial | none | none | none | partial | partial | full |
| `groovy` | partial | partial | none | none | none | partial | partial | full |
| `coffeescript` | partial | partial | none | none | none | partial | partial | none |
| `livescript` | partial | none | none | none | none | partial | partial | none |
| `lua` | partial | partial | none | none | none | partial | partial | none |
| `css` | full | none | none | none | none | full | full | none |
| `scss` | full | partial | none | none | none | full | full | none |
| `less` | full | partial | none | none | none | full | full | none |
| `stylus` | full | none | none | none | none | full | partial | none |
| `gherkin` | none | none | none | none | none | full | partial | full |
| `markdown` | partial | none | none | none | none | full | partial | none |
| `unknown` | none | none | none | none | none | none | none | none |

## Known limitations, by language

**TypeScript / JavaScript** — the reference implementation; every axis is `full` except
duplication, which uses the same generic token pipeline as every non-CSS language (structural
CSS-style comparison doesn't apply to general code). JSX/TSX also gets declaration-level
duplicate detection for elements and object literals (ADR-018).

**Python** — [ADR-002](./adr-002-python-parsing.md). Resolution is solid; exports are tracked at
module level and import symbols only partially (star imports, re-exports). Call edges and
complexity are `full` ([ADR-011](./adr-011-go-python-call-edges.md)).

**Go** — [ADR-007](./adr-007-go-resolution.md), [ADR-011](./adr-011-go-python-call-edges.md).
Exports are identifier-level; per-import symbol tracking is not done. Call edges and complexity
are `full`.

**Java** — [ADR-017](./adr-017-jvm-languages.md). Import resolution is index-based (matches by
type name across the module, not by resolving the exact package path — see
`docs/known_issues/08-cross-language-reliability.md`). Call edges cover static calls and
constructors, including through generics ([#10](https://github.com/)/issue 4), but not virtual
dispatch. Complexity is `full` (`src/parser/complexity/java.ts`). No per-import symbol tracking.

**Kotlin / Scala / Groovy** — [ADR-017](./adr-017-jvm-languages.md). Share Java's index-based
`JvmLangResolver`. **No call edges and no complexity** — the Java `@lezer` scanner is
hand-rolled and doesn't port; Kotlin/Scala/Groovy need their own grammar (tracked as issue 8c).
Scala and Groovy have test-tag strategies (ScalaTest, JUnit/Spock); Kotlin does not yet.

**CoffeeScript / LiveScript / Lua** — resolution falls back to generic relative-path handling.
No call edges, no complexity (backfill planned — see the language coverage roadmap). LiveScript
has no export tracking. Categories are heuristic-only and less validated than the mainstream
languages.

**CSS / SCSS / Less** — [ADR-001](./adr-001-styles-parsing.md),
[ADR-013](./adr-013-duplicate-detection-noise-reduction.md). Real PostCSS ASTs: `@import`
resolution and category are `full`, and duplication uses a **structural** rule-body comparator
plus declaration-level variable drift/consolidation ([ADR-018](./adr-018-per-language-definition-duplicates.md)).
SCSS/Less additionally export root-level `$`/`@` variables, mixins, and functions.

**Stylus** — parsed, `@import` resolves, but there is no shared PostCSS AST, so duplication
rides the generic token pipeline (`partial`) rather than the structural comparator.

**Gherkin** — [ADR-008](./adr-008-tag-applier-strategies.md). Feature files have no imports or
symbols; they get a dedicated test-tag strategy and are always categorized as tests.

**Markdown** — [ADR-009](./adr-009-markdown-parsing.md). Contributes edges only via code-span
file references (`` `src/foo.ts` ``), which is why import resolution is `partial`. Markdown-family
duplicates are detected but excluded from `find_duplicates` output by default (`includeDocs`).

**unknown** — non-code assets (`.json`, images, `.svg`) pulled into the graph by an explicit
import. Nothing is extracted; excluded from duplicate scanning entirely.

## Related

- [`docs/known_issues/08-cross-language-reliability.md`](./known_issues/08-cross-language-reliability.md) — the umbrella issue this matrix is the first slice of.
- `analyze` → `languageCoverage` — the same data for the languages actually in your graph.
