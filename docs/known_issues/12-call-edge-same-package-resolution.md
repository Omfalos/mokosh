# Issue 12 — Bare calls to a same-package sibling's symbol produce no call edge (Kotlin/Java)

Status: **shipped (2026-10-01)**. Found dogfooding v0.5.4 against ktorio/ktor (call-graph tool
audit). See "Decided approach" and "Shipped" below for the design that was actually built —
supersedes the "Proposed fix" section's open options.

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

## Decided approach (2026-10-01)

A `Plan`-agent pass validated the proposed fix against this repo's own blast radius
(`get_affected` on the candidate files) before this was finalized, and found two corrections to
the analysis below the original "Proposed fix" section had missed:

- **Java's gap is narrower than it looks.** Java's grammar never allows a bare, unqualified
  cross-class call — every call is either `this.foo()` (same class, not cross-file) or already
  qualified (`Foo.bar()` / `new Foo()`). The real Java gap is purely: `Foo` doesn't need an
  `import` when it's a same-package sibling type, and the resolver today only recognizes
  explicitly-imported types. So Java needs **no separate symbol index** — it reuses the exact same
  post-drain mechanism built for Kotlin below, just triggered by "unqualified type name" instead
  of "bare function call."
- **`JvmLangResolver`'s package index is filesystem-walk-based**, not graph-order-dependent, which
  made a resolver-level symbol index (reading every JVM file's full content a second time) a real
  alternative — but it was rejected in favor of the option below for cost reasons.

**Decisions:**

1. **Mechanism: builder-level post-drain pass**, not a resolver-level symbol index. The post-drain
   pass reuses `FileNode.exports` — data the normal per-file parse (via `@lezer/java` for Java,
   the first-party grammar for Kotlin, see ADR-021) already computes — so it costs zero extra file
   reads or re-parsing. The rejected alternative would have required re-reading and re-scanning
   every JVM file's full content a second time, project-wide, every build.
2. **No parse-time filter on marker emission.** The parser-side fallback fires on every
   `localNames`/`importedTypeMap` miss (including Kotlin stdlib calls like `println`/`let`/`map`),
   relying on the post-drain pass's cheap map-miss to drop non-matches for free, exactly as today.
   **Before merging**, validate `rawCallEdges` volume against a real stdlib-heavy corpus (OkHttp or
   kotlinx.coroutines, both already used for ADR-021's measurements) to confirm this doesn't
   inflate per-file payloads unacceptably.
3. **Marker encoding: a NUL-prefixed sentinel string** inside `toSpecifier` (e.g.
   `` `\0jvm-same-package-call:<package>:<name>` ``), reusing the same convention
   `GO_SAME_PACKAGE_SPECIFIER` already established for Go's same-package **import** edge. No
   change to any shared type; the marker is parsed back out only inside the post-drain pass.
4. **Ambiguity: drop the edge.** When more than one sibling in the same package partition declares
   a matching name, resolve nothing rather than guessing — consistent with the existing
   "no match → external" convention this resolver already follows elsewhere, and consistent with
   issue 13's decision for the same underlying "don't guess" concern.
5. **Scala/Groovy: explicitly out of scope**, not a gap being left open — neither has any
   call-edge extraction yet (no pure-JS AST exists for either). If/when either gets a first-party
   Lezer grammar in this repo (the path Kotlin took via ADR-021, rather than waiting on an
   upstream grammar that doesn't exist), this same-package case should be designed in from the
   start rather than rediscovered — noting it here so that future work knows to check.
6. **Go/Python: confirmed no parallel fix needed.** Go requires explicit `pkg.Func()` qualification
   for anything outside the current file — there's no bare-same-package-call shape in Go at all.
   Python's call-edge tracking is deliberately narrow by design (ADR-011) — it already doesn't
   resolve calls through a module/variable, so this isn't a new gap for Python either.
7. **Incremental-cache interaction: accepted as a documented caveat, not solved in v1.** If a
   sibling file is added/removed/renamed between builds without the calling file itself changing,
   that file's cache-hit same-package call edges stay frozen until it's next re-parsed. This only
   surfaces outside a full rebuild (fresh clone, CI, `--clear-cache`), which is the common path
   anyway — worth one sentence in the eventual ADR update, not a blocker.

## Shipped (2026-10-01)

Built exactly per the decided approach above, with no deviations:

- **Parser side**: `src/parser/lang/jvm-scan.ts` exports `jvmSamePackageCallSpecifier` /
  `parseJvmSamePackageCallSpecifier` (the `\0jvm-same-package-call:<package>:<name>` sentinel,
  mirroring `GO_SAME_PACKAGE_SPECIFIER`'s convention). Kotlin's `walkBody` and
  `collectSuperclassCallEdges` (`src/parser/complexity/kotlin.ts`) emit the marker on every bare
  `localNames` miss, with no filter. Java's `collectRawCallEdges`
  (`src/parser/lang/java.ts`) emits it for an unqualified (non-`ScopedTypeName`) type reference
  in a `MethodInvocation` qualifier or `ObjectCreationExpression` that misses `importedTypeMap` —
  restricted to a capitalized qualifier for `MethodInvocation` so an ordinary lowercase-variable
  instance call (`list.add(x)`) is never marked.
- **Builder side**: `GraphBuilder.resolveJvmSamePackageCallEdges` (`src/graph/builder.ts`) runs
  after `processTestFiles`/`processDocFiles`, groups every parsed JVM `FileNode` by
  `(declared package, module, source-root)` — reusing `jvmPathPartition`
  (`src/graph/lang-resolvers/jvm.ts`) — and resolves each pending marker against the matching
  partition's `FileNode.exports`. Exactly one match → `CallEdge`; zero or more than one → dropped
  silently. The caller's own file is excluded from candidates (a same-*file* bare call is a
  separate, pre-existing gap this issue never targeted).
- **Volume check**: a synthetic Kotlin file with 200 chained stdlib calls
  (`listOf(...).map{}.filter{}.let{ println(it) }`) produced one deferred marker per call site —
  linear in call-site count, not a blowup (~36 KB of marker payload for ~206 lines, discarded
  entirely once the post-drain pass runs and finds no matching sibling). No real OkHttp/
  kotlinx.coroutines corpus was available in this environment (no network access), so the
  measurement is synthetic rather than against the real corpora ADR-021 used — a gap worth closing
  with a follow-up run against a real checkout.
- **Tests**: `src/parser/lang/kotlin.call-edges.test.ts` and `java.call-edges.test.ts` cover the
  parser-side marker emission (including two tests that pre-existed as "stays unresolved"
  regressions and were updated to assert the new deferred-marker shape instead, since that's
  exactly the behavior this issue changed). `src/graph/builder.test.ts` adds an end-to-end
  same-package Kotlin resolution test, an ambiguous same-name-in-two-siblings test asserting the
  edge is dropped, and a Java `new Foo()`/`Foo.bar()` same-package resolution test.
- **Docs updated**: `docs/adr-021-kotlin-parsing.md` (new "Same-package call-edge resolution"
  section), `docs/adr-011-go-python-call-edges.md` (note confirming Go/Python needed no parallel
  fix), `docs/language-support.md`, and `src/languages/adapters/jvm.ts`'s Java/Kotlin `callEdges`
  caveat text.

## Proposed fix (superseded by "Decided approach"/"Shipped" above; kept for the original reasoning)

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
