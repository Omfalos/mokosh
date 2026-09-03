# Issue 8 — Reliability and feature parity are uneven across supported languages

Status: proposed, not started. Umbrella / tracking issue. Found dogfooding v0.5.0
(2026-09-03).

## Symptom

mokosh advertises 12+ languages, but the depth of support varies widely and the gaps are
undocumented, so a user running `analyze` on a Kotlin or Lua repo gets a graph that silently
omits complexity, call edges, and accurate categories — with no signal that the result is
lower-fidelity than the same call on a TS repo. `analyze`'s `languageCoverage` block is a
start (it reports `exportsTracked` / `importSymbolsTracked` / `callEdgesTracked` per type) but
it doesn't cover resolver accuracy, category accuracy, complexity, tag strategies, or
duplication semantics, and nothing acts on it.

Observed on the mokosh repo itself: `languageCoverage` shows `markdown` and `unknown` files
with everything untracked, and the 4 reported "cycles" are all markdown
([issue 5](05-find-duplicates-and-cycles-noise.md)).

## Root cause

Support was added language-by-language (ADR-002 Python, ADR-007 Go, ADR-011 Go/Python call
edges, ADR-017 JVM) with no parity checklist, so each language covers a different subset of:

| Capability | TS/JS | Python | Go | Java | Kotlin | Scala | Groovy | Coffee/LS | Lua | CSS-family | Gherkin | Markdown |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| import resolution | full | good | good | index-based (issues 3) | shared w/ Java | shared, brace-pkg gap | shared | ? | basic | @import | n/a | code-span refs |
| export symbols | full | mods | idents | top-level types | ? | ? | ? | ? | ? | n/a | n/a | n/a |
| import symbols | yes | partial | ? | no | no | no | no | ? | ? | n/a | n/a | n/a |
| call edges | yes | yes | yes | static+ctor (issue 4) | no | no | no | no | no | n/a | n/a | n/a |
| complexity | yes | yes | yes | yes | no | no | no | partial | no | n/a | n/a | n/a |
| category accuracy | high | med | med | med (issue 3d) | med | med | low | low | low | high | n/a | n/a |
| test-tag strategy | jest/vitest/cypress/playwright | pytest | go | JUnit/ScalaTest | ? | ScalaTest | ? | n/a | n/a | n/a | gherkin | n/a |
| duplication semantics | generic | generic | generic | generic (issue 7) | generic | generic | generic | generic | generic | structural | generic | generic |

(Cells marked `?` are exactly the problem — nobody has verified them.)

## Fix plan

### 8a — a language-parity matrix as a living doc + test

- `docs/language-support.md`: the table above, authoritative, with a "known limitations"
  paragraph per language linking the relevant ADR.
- A conformance test suite `test/conformance/<lang>/` — one small idiomatic fixture project
  per language with a golden `analyze` + `find_duplicates` + `get_call_graph` snapshot.
  Snapshots make regressions and gaps visible in review.

### 8b — surface fidelity to the caller

- Extend `analyze`'s `languageCoverage` to a per-language `fidelity` object:
  `{ importResolution, exportSymbols, importSymbols, callEdges, complexity, category,
  duplication }` each `"full" | "partial" | "none"`, sourced from a single
  `LANGUAGE_FIDELITY` table in `src/const.ts` (kept in sync with 8a by a test).
- When a tool's result is degraded for the languages in play (e.g. `get_call_graph` on a
  Kotlin-only repo), include a `caveats: [...]` field in the response instead of returning a
  confident-looking empty result.

### 8c — close the highest-value gaps (ordered)

1. **Kotlin call edges + complexity** — largest user base with a total gap; the Java Lezer
   approach doesn't port (hand-rolled scanner), so needs a real Kotlin grammar
   (`@lezer` Kotlin or tree-sitter via the ADR-002 constraints) — spike first.
2. **JVM category accuracy** (issue 3d, fixed in #11) — cheap, high
   value.
3. **Import-symbol tracking for JVM** — currently `no` everywhere; needed for
   `exportUsageRatio` / dead-export analysis to work on JVM.
4. **Groovy** resolution + category audit (lowest current fidelity).
5. **Coffee/LiveScript/Lua** complexity + call edges (per the existing
   [language coverage roadmap](../../MEMORY.md) — Coffee/LS/Lua backfill was already planned).

### 8d — resolver robustness pass

- Every `LangResolver` should degrade gracefully: unresolved specifier → dropped edge, never
  a crash or a wrong local match. Add a `test/conformance` case per language with an
  unresolvable import and assert no throw + no phantom node.
- Audit the "local package shadows an external dependency" failure mode (documented for JVM
  in ADR-017; check Go and Python have the same guardrails).

## Expected outcome

- A user can see, before trusting a result, exactly what mokosh does and doesn't extract for
  their language.
- Regressions in any language's fidelity fail CI via conformance snapshots.
- Kotlin reaches call-edge + complexity parity with Java.

## Test plan

- `test/conformance/<lang>/` golden snapshots for all 12 languages (new).
- Unit: `LANGUAGE_FIDELITY` table matches `docs/language-support.md` (parse the doc table in
  the test).
- Unit: `analyze` `languageCoverage.fidelity` reflects the table for a mixed-language graph.
- Unit: each resolver, given an unresolvable specifier, returns `null` and does not throw.
- Regression: TS/JS conformance snapshot unchanged (guards against generic-path regressions
  while adding per-language paths).

## Files touched

new `docs/language-support.md`, new `test/conformance/**`, `src/const.ts`
(`LANGUAGE_FIDELITY`), `src/mcp/handlers.ts` (`analyze` response + per-tool `caveats`),
`src/graph/queries.ts`, per-language parsers/resolvers as 8c items are picked up,
`docs/architecture.md` (link the matrix).

## Dependencies

Umbrella issue — [issues 3, 4, 5, 7](.) are all specific instances. Do those first; this
issue's matrix + conformance harness is what keeps them from regressing and what makes the
remaining gaps (Kotlin, Groovy, Lua) visible and prioritized.
