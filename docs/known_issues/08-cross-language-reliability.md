# Issue 8 — Reliability and feature parity are uneven across supported languages

Status: **8a, 8b and 8d shipped** (8a/8b first slice 2026-09-08; conformance harness, `caveats`,
resolver-robustness pass 2026-09-08). Only **8c** (closing the actual language gaps) remains.
Umbrella / tracking issue. Found dogfooding v0.5.0 (2026-09-03).

## Shipped

- **8a — parity matrix.** `docs/language-support.md` is the authoritative per-language matrix
  across 8 axes (import resolution, export symbols, import symbols, call edges, complexity,
  category, duplication, test tags), each `full | partial | none`, with per-language
  known-limitations prose + ADR links. `LANGUAGE_FIDELITY` in `src/graph/language-support.ts` is
  the machine-readable twin; a test keeps the two in exact sync and asserts the four set-backed
  axes agree cell-for-cell with their `*_TYPES` source of truth (drift guard).
- **8a — conformance harness.** `example/full-house/conformance.test.ts` builds the real
  multi-language `full-house` fixture graph (one idiomatic file per language, JVM sub-tree built
  from its own root) and asserts (1) each present language's `fidelity` row equals
  `LANGUAGE_FIDELITY` *on a built graph*, (2) a per-language extraction summary
  (`files` / `withImports` / `withResolvedImports` / `withExports` / `withCallEdges` /
  `withComplexity`) against an explicit `BASELINE` — regenerable with `UPDATE_CONFORMANCE=1`,
  readable in review the way a golden snapshot isn't, (3) `unknown` aside, every `FileType` has a
  fixture (new languages can't skip conformance), (4) `callEdges === "none"` languages really
  extract zero call edges. Added `example/full-house/notes.md` so Markdown is covered.
  Chose explicit-assertion baselines over `toMatchSnapshot` to match the codebase (no `.snap`
  files anywhere).
- **8b — `fidelity` in `languageCoverage`.** `getLanguageCoverage` / `analyze`'s
  `languageCoverage[]` carry the full 8-axis `fidelity` object alongside the existing booleans.
- **8b — per-tool `caveats`.** `languageCaveats(graphs, axis)` + `languageCaveatsSummary(graphs)`
  in `src/graph/language-support.ts` emit one advisory sentence per present language whose axis
  is `partial`/`none` *and* carries a concrete reason (or is entirely absent) — a bare
  unexplained `partial` (the norm for `category` / `duplication`) stays silent so it doesn't fire
  on every repo. Per-language reason strings live in a `FIDELITY_CAVEAT` table sourced from
  `docs/language-support.md`'s prose. Wired into `analyze` (aggregate `caveats`, precision axes
  only) and into `get_dependencies` / `get_dependents` (importResolution), `get_callers` /
  `get_call_graph` / `find_symbol` (callEdges), `find_complex_functions` / `find_risk_hotspots`
  (complexity), `find_duplicates` (duplication — Stylus only, in practice). Complements
  `languageSupportNote`, which still fires only on a *fully empty* result.
- **8d — resolver robustness.** `DefaultResolver.resolveAllUncached` now wraps the per-language
  `LangResolver.resolve()` call in try/catch: a throw degrades to a dropped edge (falls through
  to workspace / external resolution), with one stderr warning per resolver class per process
  (`warnResolverThrewOnce`). New `src/graph/lang-resolvers/robustness.test.ts`: every resolver
  returns `null` (no throw) for an unresolvable specifier; a deliberately-throwing resolver is
  isolated and warned once; Go's `mod/`-prefix + trailing-slash check and Python's
  existence-gated root-relative probing are both asserted as the "local shadows external"
  guardrails (Go: a same-prefix external module stays external; Python: local-first is the
  correct import-time semantic, so only an on-disk `pkg/__init__.py` shadows — by design).

- **Bugs found + fixed by the drift guard:** `FUNCTION_COMPLEXITY_TYPES` was missing `java`
  even though `src/parser/complexity/java.ts` fully populates per-function complexity — added.
  New `TEST_TAG_STRATEGY_TYPES` set added as the source of truth for the `testTags` axis.
- **Discrepancy surfaced by the conformance harness (not yet fixed — folds into 8c):**
  LiveScript `.ls` files *do* get `exports` extracted through the graph
  (`full-house.test.ts` asserts `app.ls` → `[{name:"greet"}]`), but `livescript` is absent from
  `EXPORT_TRACKING_TYPES` and `LANGUAGE_FIDELITY.livescript.exportSymbols` is `"none"`. The
  harness records the real count; the table/set and docs should be updated (or export tracking
  formally dropped) as part of the LiveScript slice of 8c.

## Not done (issue stays open for 8c only)

- **8c** — closing the gaps: Kotlin call edges + complexity (needs a real grammar — spike
  first), JVM import-symbol tracking, Groovy resolution/category audit, Coffee/LS/Lua complexity
  + call edges, and the LiveScript export-tracking table fix above. The conformance harness now
  makes each of these a visible, regression-locked baseline change.
- **8a harness scope** — `full-house` is one fixture with one file per language; per-language
  `find_duplicates` / `get_call_graph` golden checks and larger idiomatic fixtures can be layered
  on later, but the fidelity + extraction-count drift guard is in place.

---

## Original write-up

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
