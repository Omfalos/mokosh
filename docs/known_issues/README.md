# Known issues

Point-in-time issue write-ups from dogfooding mokosh (v0.5.0 through v0.5.5) against real
Java/Kotlin/Scala/Go/Python monorepos and against mokosh itself, 2026-09-03 through 2026-10-03.
Each file is a self-contained plan: symptom, root cause with `file:line` references, fix, test
plan, and cross-issue dependencies.

## Open

Issues with real remaining scope — a partial ship, or no fix started at all. Ordered by number.

| # | File | Symptom |
|---|------|---------|
| 6 | [`06-duplicates-query-language.md`](06-duplicates-query-language.md) | `find_duplicates` output too large for an LLM. **6a–6c shipped** (`filter` DSL + `slim` + `summary`); 6d (shared shaping layer) and the overlapping-window matcher fix remain |
| 7 | [`07-per-language-analysis-semantics.md`](07-per-language-analysis-semantics.md) | Analyses treat every language like JS/TS; JVM data shapes, idiom exclusion, and the per-language config surface still go undetected/unbuilt (CSS vars + TS types shipped in phase 1) |
| 8 | [`08-cross-language-reliability.md`](08-cross-language-reliability.md) | Umbrella: uneven feature parity across languages. **8a/8b/8d shipped** (parity matrix + `LANGUAGE_FIDELITY` + `analyze` `fidelity`; `example/full-house/conformance.test.ts` drift guard; per-tool `caveats`; resolver try/catch + robustness tests). **8c partially shipped** (JVM import-symbol tracking; Kotlin test-tag strategy; Kotlin call edges/complexity via a first-party grammar, [ADR-021](../adr-021-kotlin-parsing.md)). Remaining 8c: Groovy audit, Coffee/LS/Lua |
| 16 | [`16-stale-mcp-server-process-after-rebuild.md`](16-stale-mcp-server-process-after-rebuild.md) | A long-lived `mokosh` MCP server process keeps serving pre-rebuild logic after `npm run build` — `clear_cache` cannot fix this, since it only clears cache state, never the process's already-loaded code |
| 17 | [`17-test-pattern-registry-js-biased.md`](17-test-pattern-registry-js-biased.md) | The core test-file discovery registry (`src/parser/classify.ts`) is JS/TS-biased; Go's `_test.go` files never become graph nodes when real entry points are given, and Python's `test_*.py` convention is latently affected too |
| 18 | [`18-find-unused-no-test-exclusion.md`](18-find-unused-no-test-exclusion.md) | `find_unused` has no test-file exclusion via MCP at all, and the CLI's own `--exclude-tests` duplicates issue 17's JS-biased pattern list in a third place |
| 19 | [`19-kotlin-extension-property-export-gap.md`](19-kotlin-extension-property-export-gap.md) | Kotlin extension *properties* (`val Receiver.x: T get() = ...`) are mis-captured by the export scanner's name regex — the receiver type name is captured instead of the real property name |
| 20 | [`20-query-importsfiles-pruning-undocumented.md`](20-query-importsfiles-pruning-undocumented.md) | `query`'s `importsFiles` is silently trimmed to edges whose target is also in the filtered result set — undocumented, reads as a false "this file has no imports" |
| 21 | [`21-call-edge-toFile-silent-ambiguity.md`](21-call-edge-toFile-silent-ambiguity.md) | `CallEdge.toFile` silently picks `matches[0]` when a call target's name resolves to more than one file at build time — issue 13 fixed this for `get_call_graph`'s query-time lookup, but not for this earlier, separate build-time resolution step that `query`'s raw `callEdges` still relies on |

## Resolved

Issues whose own write-up is self-declared `fixed`/`shipped` — including ones with a minor,
explicitly-noted optional follow-up still open (never a load-bearing gap). Kept in
`known_issues/` rather than moved to an archive directory: several are cited by path directly in
source comments (`src/graph/builder.ts`, `src/graph/duplication/index.ts`), and moving the files
would mean finding and updating every such citation with no guarantee none is missed.

| # | File | Symptom |
|---|------|---------|
| 5 | [`05-find-duplicates-and-cycles-noise.md`](05-find-duplicates-and-cycles-noise.md) | **Fixed** — `find_duplicates`/`cycles` noise: kind-aware cycle filtering (`docReference`/`samePackage` skipped by default) + generated/vendored-file skip + import-block masking + advisory `signals` |
| 9 | [`09-duplicate-clone-family-noise.md`](09-duplicate-clone-family-noise.md) | **Fixed** — `find_duplicates` reported one row per LCP-tree node instead of per clone family; dominance filter + exact-file-set clustering fixed the reported case. Connected-component clustering for a further, non-nested noise class remains a possible follow-up, not a reopening of this issue |
| 10 | [`10-api-surface-response-size.md`](10-api-surface-response-size.md) | **Fixed** — `get_api_surface` returned a ~14K-token full payload; now summary-first (`view: "summary"` default, ~1K tokens), and `bin` entries are recognized as entry points so CLI/MCP code stops being mislabelled unreachable |
| 11 | [`11-disk-cache-not-invalidated-by-mokosh-version.md`](11-disk-cache-not-invalidated-by-mokosh-version.md) | **Fixed** — `clear_cache` silently left a stale on-disk workspace cache in place; it now deletes `mokosh-cache/workspace/` too. Automatic staleness detection via a version-derived manifest remains open |
| 13 | [`13-call-graph-definition-ambiguity.md`](13-call-graph-definition-ambiguity.md) | **Fixed** — `get_call_graph`'s `definedIn` silently picked one file when a function/method name was exported by more than one; now reports `definedInCandidateCount` and withholds `definedIn`/`callees` (not `callers`) rather than guessing, with a `file` arg to disambiguate |
| 12 | [`12-call-edge-same-package-resolution.md`](12-call-edge-same-package-resolution.md) | **Fixed** — bare calls to a same-package sibling's symbol (no import needed in Kotlin/Java) produced no call edge; a deferred marker + post-drain resolution pass now resolves them against the package partition's `exports`, dropping silently on ambiguity rather than guessing |
| 14 | [`14-empty-entrypoints-doc-reference-leak.md`](14-empty-entrypoints-doc-reference-leak.md) | **Fixed** — `analyze(entryPoints: [])` on a plain repo built a small, non-deterministic graph seeded only by markdown doc-reference mentions; it now discovers every source file as its own entry point |
| 15 | [`15-gradle-unary-plus-dsl-detection.md`](15-gradle-unary-plus-dsl-detection.md) | **Fixed** — Gradle monorepo detection missed settings files using Kotlin's unary-plus `+"module"` project DSL (ktor: 0 → 136 packages) |
| 22 | [`22-gradle-composite-build-not-detected.md`](22-gradle-composite-build-not-detected.md) | **Fixed** — Gradle composite builds (`includeBuild(...)`) were invisible to the workspace graph; an in-root target now detects like any `include(...)` module (validated on `square/workflow-kotlin`), and an out-of-root target can be named explicitly via `MokoshConfig.extraRoots`, resolving cross-module refs in both directions with no Gradle invocation |

## Details

- **Issue 22** — [`22-gradle-composite-build-not-detected.md`](22-gradle-composite-build-not-detected.md) —
  `includeBuild(...)` (composite builds — a distinct mechanism from `include(":module")`) was
  never parsed by `gradleDetector`, so an included build was invisible to the workspace graph
  regardless of whether it sat inside or outside the analyzed root. Fixed in two slices: an
  in-root target now resolves exactly like any `include(...)` module (validated on a real repo,
  `square/workflow-kotlin`'s `includeBuild("build-logic")`: 2 → 3 packages, `workflow-core`'s
  dependency on `build-logic` now correctly reported); an out-of-root target (a sibling checkout)
  is named explicitly via a new `MokoshConfig.extraRoots: string[]` field rather than
  auto-discovered, folding in as its own `externalRoot: true` package whose `relativeRoot`/node
  paths legitimately carry `..` segments — `JvmLangResolver`'s package index spans every named
  root, so an FQN import crosses the boundary in either direction with no Gradle invocation. No
  new CLI flag or MCP arg was needed: both already apply every `MokoshConfig` field uniformly via
  `configToGraphOptions()`.
- **Issue 15** — [`15-gradle-unary-plus-dsl-detection.md`](15-gradle-unary-plus-dsl-detection.md) —
  `gradleDetector` only recognized Gradle's standard `include(":module")` syntax, so ktorio/ktor's
  custom settings-plugin DSL (Kotlin's unary-plus operator, `+"module-name"`, instead of
  `include(...)`) was never detected — `get_workspace_packages` reported "not a recognized
  monorepo root" despite ktor being a real ~136-module Gradle build. Fixed: a fallback parser
  extracts every `+"module-name"` token and resolves each to a real directory by basename search
  (the DSL's block nesting doesn't encode a reliable path — a block named `server`'s modules live
  under a differently-named `ktor-server/` directory, while `shared`'s modules have no prefix
  directory at all). `detectMonorepo` now correctly returns 136 packages for ktor, matching the
  real layout exactly, including nested modules declared via `including { }`.
- **Issue 13** — [`13-call-graph-definition-ambiguity.md`](13-call-graph-definition-ambiguity.md) —
  `get_call_graph`'s `definedIn` silently picked one file when a function/method name was
  exported by more than one (e.g. an interface method implemented by several receiver types, or
  a common helper name reused across packages), with no signal that other definitions existed —
  confirmed on mokosh's own codebase (`run`, exported by 24 CLI commands plus the dispatcher).
  Fixed: a new, always-present `definedInCandidateCount` field reports how many files matched (`1`
  in the normal, unambiguous case — `definedIn`/`callees` behave exactly as before, zero
  regression); when it's `>1`, `definedIn` is `null` and `callees` is empty rather than guessed,
  while `callers` (independent of which file "really" defines the name) is still returned. A new
  `file` arg disambiguates by narrowing the search to one path, bypassing the ambiguity entirely;
  `includeCandidates: true` opts into the full `candidates: string[]` list. A per-receiver-type
  disambiguator and a shared `findExportingNodes()` helper with issue 12 are deferred. See
  [ADR-003](../adr-003-call-edge-graph.md)'s Query API section and
  [docs/mcp.md](../mcp.md)'s `get_call_graph` entry.
- **Issue 12** — [`12-call-edge-same-package-resolution.md`](12-call-edge-same-package-resolution.md) —
  bare calls to a same-package sibling's symbol (no import needed in Kotlin/Java) produced no call
  edge — `get_call_graph`/`get_callers` returned empty despite real, confirmed call sites. Fixed:
  the parser side emits a deferred `\0jvm-same-package-call:<package>:<name>` marker on every
  `localNames`/`importedTypeMap` miss (Kotlin bare calls, Java unqualified type references), and a
  new `GraphBuilder.resolveJvmSamePackageCallEdges` post-drain pass resolves each marker against
  the matching package partition's `FileNode.exports` once the whole graph exists — exactly one
  match becomes a `CallEdge`, ambiguous (two+ matches) drops silently.
- **Issue 14** — [`14-empty-entrypoints-doc-reference-leak.md`](14-empty-entrypoints-doc-reference-leak.md) —
  `analyze(entryPoints: [])` on a plain (non-monorepo) repo left the build queue empty, so the
  only files that ever entered the graph were whatever a markdown doc-reference edge happened to
  resolve to — recursively expanded through real imports exactly like a genuine entry point,
  producing a small, non-deterministic slice of the real source tree that looked like a complete
  result (confirmed: gin-gonic/gin's `CHANGELOG.md` mentioning `mode.go` alone produced a
  33-node graph, missing ~40 other real Go files; ktorio/ktor got zero Kotlin files at all).
  Fixed: `GraphBuilder.build()` now discovers every non-test, non-doc source file under `rootDir`
  and enqueues each as its own entry point when none were given (gin: 33 → 108 nodes; ktor:
  0 → 3,210 Kotlin files; flask: 22 → 83 Python files). A smaller related gap — the markdown
  doc-reference extractor not recognizing JVM file extensions at all — is noted but not fixed.
- **Issue 11** — [`11-disk-cache-not-invalidated-by-mokosh-version.md`](11-disk-cache-not-invalidated-by-mokosh-version.md) —
  `clear_cache` only dropped in-memory state; the on-disk per-package workspace cache, keyed off
  only the target repo's own source digest, kept serving a graph built by an older mokosh until
  `mokosh-cache/` was deleted by hand. Fixed: `clear_cache` now also deletes
  `<root>/mokosh-cache/workspace/`. The more thorough fix (deriving the manifest's staleness
  check from mokosh's own version, so a stale disk cache is caught automatically without an
  explicit `clear_cache`) remains open.
- **Issue 10** — [`10-api-surface-response-size.md`](10-api-surface-response-size.md) —
  `get_api_surface` returned a ~14K-token full `ApiSurface` on a single-package repo, and
  `unreachableFromEntry` mislabelled CLI/MCP code as dead because `bin` wasn't an entry-point
  source. Fixed: `detectAllEntryPoints` now reads `package.json` `bin`; the single-surface
  response is summary-first (`summarizeApiSurface` + `view: "summary" | "exports" | "full"`,
  default `"summary"` ≈ 1K tokens), `view: "full"` restores the old payload.

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
4. **Issue 8** — ~~parity matrix~~ + ~~conformance harness~~ + ~~per-tool caveats~~ +
   ~~resolver-robustness pass~~ (all **shipped**: `docs/language-support.md` + `LANGUAGE_FIDELITY`
   + `analyze` `fidelity`/`caveats`; `example/full-house/conformance.test.ts`; `languageCaveats`
   wired into 8 tools; `LangResolver` try/catch + `lang-resolvers/robustness.test.ts`). 8c:
   ~~JVM import-symbol tracking~~ + ~~Kotlin test-tag strategy~~ + ~~Kotlin call edges +
   complexity~~ **shipped** (the last via a first-party Lezer grammar, ADR-021). Remaining: Groovy
   audit, Coffee/LS/Lua, LiveScript export-tracking table fix, and issue 7's remaining languages.
   The conformance harness now regression-locks each as a baseline
   change.
