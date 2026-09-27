# Issue 12 — Bare calls to a same-package sibling's symbol produce no call edge (Kotlin/Java)

Status: **open**. Found dogfooding v0.5.4 against ktorio/ktor (call-graph tool audit).

## Symptom

`get_call_graph` and `get_callers` return empty `callers`/`callees` for functions that are
genuinely called, when the call site and the call target are in the same package but different
files — the single most common cross-file call shape in idiomatic Kotlin/Java, since neither
language requires an `import` for a same-package reference.

Confirmed on the real ktor source:

- `ktor-http/common/src/io/ktor/http/URLParser.kt:204` and `URLUtils.kt:100` both call
  `parseQueryString(...)` unqualified. `parseQueryString` is declared in a sibling file of the
  same `io.ktor.http` package. Neither call site has an `import` line for it (none is needed).
  `get_call_graph(function: "parseQueryString")` → `callers: []`.
- `Cookie.kt:209`: `expires?.toHttpDate()` — an extension-function call
  (`fun GMTDate.toHttpDate()`, declared in `DateUtils.kt`, same package). No import.
  `get_callers` for `DateUtils.kt` → `0` callers.

Neither case is explained by the already-documented Kotlin call-edge caveats (single-level
qualifiers only, no virtual dispatch, wildcard-imported qualifiers unresolved, ASI
mis-nesting) — both call sites are single-level and unambiguous. `find_complex_functions`
succeeds on these exact same files at the same time, which rules out the shared 5%
error-node-density gate as the cause (that gate is shared between complexity and call-edge
extraction per `analyze()`'s own caveat text — if it were gating call edges here it would also
gate complexity, and it doesn't).

## Root cause

`src/parser/complexity/kotlin.ts`'s `walkBody` (mirrored by `src/parser/complexity/java.ts`)
resolves a call's target purely from `localNames`, a **per-file** map built only from that
file's own `import` lines (`src/parser/lang/kotlin.ts:96-106`). A bare call whose target is
never imported — because Kotlin/Java don't require an import for a same-package reference — has
no entry in `localNames` and is silently dropped; `walkBody` has no fallback path.

This is architecturally different from a per-call-site parsing gap: fixing it needs the call-edge
resolver to know "does some file in my own package declare a symbol named X?", which requires a
whole-project symbol index. That index already exists — `JvmLangResolver`'s package index
(`src/graph/lang-resolvers/jvm.ts`, `PackageIndex`) — but it's built and used at the
**resolver/builder level**, after the whole graph's nodes exist, not at **parse level**, where
`collectCallEdges` currently runs on one file in isolation with no visibility into any other
file's declarations.

Contrast with the same-package **import**-edge case, a narrower problem already solved for JVM
(`jvmPackageEdge`, pre-existing) and, as of the `fix/go-same-package-edge` branch (not yet merged
as of this writing), for Go too (`goSamePackageEdge`): that fix only needed to say "this file is
coupled to every file in its own package," which the existing package index already answers
per-directory/per-partition with no extra symbol-level work. Call-edge resolution needs the
finer-grained question "which *specific* sibling file declares the symbol actually being
called" — a real per-symbol name lookup, not just package membership.

## Why this isn't a quick fix

- `collectCallEdges` (`src/parser/complexity/kotlin.ts`) runs per-file, synchronously, with no
  access to other files' `exports`. It can't answer "who declares `parseQueryString`" on its own.
- The graph builder's wavefront (`src/graph/builder.ts`, `GraphBuilder.build()`) parses files in
  parallel rounds; a file's siblings may not have been parsed yet when its own call edges are
  resolved, the same reason test-file tags and doc-file links are deferred to an explicit
  post-drain pass (`processTestFiles`/`processDocFiles`) rather than resolved inline.
- A same-package symbol name can collide: two sibling files could each declare a same-named
  top-level function (legal in different `object`/`companion object` scopes, or via overloads)
  — resolution would need at least an "ambiguous, picked arbitrarily" signal, similar to the
  disambiguation gap in issue 13.

## Proposed fix (not built)

1. Parser side (Kotlin + Java; Go has room for the same idiom too, though Go's bare calls are
   same-*file*, not same-*package*, per `go.ts`'s existing same-file exclusion note — a narrower
   case): when `walkBody`/its Java equivalent finds a bare call whose name has no `localNames`
   entry, emit a `RawCallEdge` with a distinguishing marker (e.g.
   `toSpecifier: <SAME_PACKAGE_CALL_MARKER>:parseQueryString`) instead of silently dropping it —
   mirrors how `GO_SAME_PACKAGE_SPECIFIER` (once `fix/go-same-package-edge` merges) flags a
   same-package **import** edge for later resolution.
2. Builder side: add a post-drain resolution pass (after `drain()`, alongside
   `processTestFiles`/`processDocFiles` in `GraphBuilder.build()`) that, for every unresolved
   same-package call marker, searches the already-built package partition (reusing
   `JvmLangResolver`'s `PackageIndex`, or a lightweight symbol-name index built once per package
   partition) for a sibling file whose `exports` contains the target name, and resolves the
   `CallEdge.toFile` accordingly. Multiple matches → leave unresolved (or attach an
   `ambiguous: true` flag) rather than guessing, consistent with issue 13's disambiguation
   concern.
3. Update `docs/adr-021-kotlin-parsing.md` / `docs/adr-011-go-python-call-edges.md` caveats once
   shipped; downgrade the `callEdges` fidelity caveat text in
   `src/languages/adapters/jvm.ts` accordingly.

## Test plan (for whoever picks this up)

- `src/parser/complexity/kotlin.test.ts`: a bare call to a same-package (unimported) function
  produces a marked/deferred `RawCallEdge`, not silence.
- `src/graph/builder.test.ts`: end-to-end, two same-package Kotlin files (fixture, no `go`
  toolchain needed) where file A calls file B's top-level function with no import — assert
  `get_call_graph`-equivalent resolution finds the edge.
- A same-name-in-two-sibling-files fixture — assert the edge stays unresolved/flagged rather
  than picking one arbitrarily.
- Regression: existing qualified/constructor-call tests in `kotlin.test.ts` stay green.

## Cross-issue dependencies

- Builds on the same-package **import**-edge fix (JVM: pre-existing; Go:
  `fix/go-same-package-edge` branch) — reuses the same package-partition concept, one level
  deeper (symbol name, not just file membership).
- Shares its "don't guess on ambiguity" concern with issue 13 (`definedIn`/caller lookup
  disambiguation) — a combined design pass could address both at once, since both need the same
  "is this name unique in scope" check.
