# ADR-021: A First-Party Kotlin Lezer Grammar

**Date:** 2026-09-15
**Status:** Accepted — implemented. Phase 0 (grammar), Phase 1 (hybrid integration + call edges),
and Phase 2 (complexity) have all shipped; see "Next steps" at the bottom. Remaining work is
grammar coverage growth (explicit call type arguments, star projections, `@label`), not the
phases themselves.

---

## Context

ADR-017 shipped Kotlin support via a hand-rolled `package`/`import`/top-level-declaration scanner
(`src/parser/lang/jvm-scan.ts`), the same tier as Scala and Groovy: real import graph and
classification, but **no complexity, no cognitive complexity, no call edges** — those need an
actual parse tree, and ADR-017 explicitly deferred that "until a pure-JS AST exists."

This ADR is about closing that gap: getting a real, pure-JS Kotlin AST so `find_complex_functions`,
`find_risk_hotspots`, and call-graph tools can cover `.kt` files the way they already cover
TypeScript, Python, Go, and Java.

## Options considered

**1. Native tree-sitter (`tree-sitter-kotlin`) — rejected.** Same reasoning as ADR-002's rejection
of native tree-sitter for Python: prebuild fragility across Node ABIs (this project runs on
Node 24 / ARM64), and a native dependency mokosh has deliberately avoided everywhere else.

**2. WASM tree-sitter — rejected.** Avoids the native-binary problem, but tree-sitter's WASM
bindings init asynchronously; the parser pipeline (`parseFile()` → parser registry → lang parser)
is synchronous throughout, and every other parser in the registry (including `@lezer/python`,
adopted for exactly this reason in ADR-002) is sync. Adding one async-only parser would need a
special case threaded through the whole pipeline for a single language.

**3. Vendor `@fazelstudio/codemirror-lang-kotlin` — rejected.** A third-party Lezer grammar exists
on npm, but it's unmaintained community work of unclear fidelity and scope, with no visibility into
whether it handles the constructs mokosh actually needs (declaration boundaries, call expressions)
correctly or at all. Auditing and patching someone else's grammar to the bar this needs looked
comparable in effort to writing one scoped to exactly what's needed, with full control over the
result.

**4. Port JetBrains' `kotlin-spec` (the official grammar) — rejected.** `kotlin-spec` is an
**ANTLR4** grammar: adaptive LL(*) parsing with semantic predicates and runtime backtracking.
Lezer builds a **static LR(1)-style automaton** at build time and refuses to generate a parser at
all if the grammar is ambiguous. The two have incompatible disambiguation models — there is no
mechanical port, only a rewrite. A straight port of the *full* spec (contracts, destructuring,
context receivers, DSL receiver types, the works) would hit far more LR conflicts than the
grammar actually written (see "Scope cuts" below), for coverage mokosh doesn't need. kotlin-spec
was used as the **reference** for correct Kotlin structure while authoring the grammar fresh,
directly in Lezer's DSL, scoped down from the start — the same relationship the already-installed
`@lezer/python` and `@lezer/java` have to their own "official" grammars.

**5. A first-party Lezer grammar, scoped to mokosh's actual needs — chosen.** Enough to find
declaration/function boundaries and call-expression shapes for complexity/call-edge extraction,
not full Kotlin fidelity. Pure JS, no native code, no async init, fits the existing parser
registry unchanged. `@lezer/generator` (devDependency), `@lezer/common` and `@lezer/lr` (promoted
from transitive deps of `@lezer/java`/`go`/`python` to direct dependencies) are the only new
dependencies.

## The grammar

`src/parser/lang/kotlin/kotlin.grammar` covers: package/import headers, class/interface/object/
companion object declarations (including enum classes with entries, optional constructor args,
and per-entry class bodies), primary/secondary constructors, init blocks, functions, properties
with get/set accessors, typealias, if/when/try as expressions, for/while/do-while/return/break/
continue/throw statements, a fairly complete expression grammar (binary ops with real Kotlin
precedence, ranges, infix functions, is/as, prefix ops, lambdas, call expressions including
trailing lambdas, navigation `.`/`?.`, indexing, `!!`, bare callable references `Foo::bar`), and
Python-`FormatString`-style string templates (`"$x"` / `"${expr}"`, triple-quoted raw strings) via
a real external tokenizer + `ContextTracker` (`src/parser/lang/kotlin/tokens.js`), mirroring
`@lezer/python`'s approach — interpolated expressions are genuinely parsed by the real grammar
(recursively, so a lambda with its own braces inside an interpolation parses correctly), not
scanned as opaque text.

Build step: `scripts/build-kotlin-grammar.mjs` wraps `@lezer/generator`'s `buildParserFile`.
Unlike the conformance baseline's "artifact committed, regeneration explicit, CI detects drift"
pattern (`UPDATE_CONFORMANCE=1`), the generated output here (`generated/parser.js`,
`parser.terms.js`, `tokens.js`) is a **gitignored build artifact**, not committed —
`build:grammar` is chained into `npm run build`/`build:prod` (regenerated on every build), and CI
runs it as an explicit early step in `ci.yml`/`release.yml` since it also has to exist before
`typecheck`, which runs before the bundler. Because of that ordering, CI's later "Build" step
calls the bundler alone (`build:app` / `NODE_ENV=production build:app`) rather than the full
`build`/`build:prod`, so the grammar isn't regenerated a second time. `npm run verify:grammar` (`--verify`, diff a fresh rebuild
against what's currently on disk) is a local reproducibility check, not a CI gate — there's no
committed baseline to drift from. `generated/` is wholesale gitignored — nothing hand-written lives
inside it, including types: the generated `parser.js` has no types of its own, so
`src/parser/lang/kotlin/index.ts` `require()`s it and annotates the result inline
(`as { parser: LRParser }`) rather than using a type-checked `export ... from` re-export, which
would need a `.d.ts` co-located inside `generated/` to resolve. `biome.json` excludes
`src/parser/lang/kotlin/generated/`.

## Scope cuts

Each cut below caused an LR conflict (or, in two cases, a silent mis-parse — see "Silent mis-parses"
below) that a grammar-level fix didn't resolve without a materially larger rewrite. All are
documented inline in `kotlin.grammar` next to the relevant rule, and are recoverable later
("Phase 0b") if a real `.kt` file needs them.

| Cut | Why |
|---|---|
| ~~No extension functions or properties~~ **Fixed 2026-09-21** — `fun String.shout()`, `fun <T> List<T>.f()`, `fun a.b.Foo?.f()`, `val String.p get() = ...` now parse via a flat `(ReceiverSegment ("." \| SafeNav))*` prefix before `Definition`. The original diagnosis (an Identifier-vs-Definition state-merge) was right that a `receiverType "."` *wrapper* fails — its `ScopedTypeName` alternative silently swallows `Foo.bar` whole — but wrong that it was unfixable: separate `ReceiverSegment` nodes let the parser decide on the token after each identifier (`.`/`?.` → another segment, `(` or `:`/`=`/`by`/accessor → the name), with no conflicts and no external tokenizer. See "Extension receivers" below. Receiver *function* types (`Foo.() -> Unit`, `(suspend () -> T).f()`) remain a cut. |
| ~~No annotation-argument support~~ **Fixed 2026-09-16** — `@Foo(bar = 1)`/`@get:JvmName(...)` etc. now parse via the existing `ArgumentList` machinery plus the full real use-site-target list, gated by `!greedy`. The original "pulling `expression` into the modifier soup explodes the LR automaton" theory didn't hold once actually tried — see PROGRESS.md's "Annotation-argument and use-site-target support" section. | — |
| ~~No bare parenthesized type `(Foo)`~~ **Fixed 2026-09-21** — parenthesized, function and nullable-function types are now ONE production, `"(" commaSep<functionParam> ")" (!greedy "->" type)?`; no arrow means a parenthesized type. The original conflict was real for two separate rules (they diverge only after the closing paren), and disappears when the arrow is optional inside a single rule. |
| ~~No receiver-qualified function type (`Foo.() -> Unit`)~~ **Fixed 2026-09-21** — `FunctionType` starts with `((TypeName \| ScopedTypeName \| GenericType) ".")?` directly, not `simpleType`; the earlier "spurious conflict" came from reducing to `simpleType` before the `.`. Also `suspend` prefix, named parameters, and `fun (suspend () -> T).f()` (`ParenReceiver`). See "Function types" below. |
| ~~No modifiers directly before `constructor`~~ **Fixed 2026-09-16** — `private constructor(...)` now attaches its modifier correctly; the original theory ("ambiguous against the next sibling's modifier soup") didn't hold once tried, and the gap was worse than "doesn't attach": it silently swallowed the rest of the class body. See PROGRESS.md. No modifiers directly before `get`/`set` still applies (`private set` still parses, modifier still doesn't attach) — not yet attempted. | Same ambiguity class as the constructor case, untested for `get`/`set` specifically. |
| No qualified or generic callable references (only bare `Foo::bar` / `::bar`) | Using `simpleType?` instead of a bare `Identifier` would make `TypeName` and `baseExpression`'s own `Identifier` alt reduce-reduce-ambiguous on every bare identifier. |
| No `@label` support at all (`return@x`/`break@x`/`continue@x`) | Before `Nl` statement separators existed (see "Newline-separated statements" below), without newline-sensitivity, a bare `return`/`break`/`continue` immediately followed by `@` is ambiguous between "this statement's own label" and "an annotation starting the next statement" — kept resisting `!greedy` resolution via a deep interaction with `CallableReference`. Labeled non-local jumps (common inside lambdas passed to `forEach` etc.) are a real, moderately common gap. |
| No local (nested-in-function-body) class declarations | Hits the generator's own internal `statement+ -> statement+ statement+` grouping (its binary splitting of `statement*` for incremental reparsing) — no precedence marker reaches a conflict whose competing side is generator-internal rather than a sibling rule this grammar controls. |
| Local functions and local properties use narrower dedicated rules (`LocalFunctionDeclaration`, `LocalPropertyDeclaration`), not the full `FunctionDeclaration`/`PropertyDeclaration` | Same `statement+` wall as local classes, but sidestepped instead of cut outright: a local function's body is never actually optional in real Kotlin, so requiring it removes the "reduce without a body" path the wall was blocking. Local properties additionally can't have accessors, type parameters, or type constraints in real Kotlin anyway, so the narrower rule matches the language, not just LR(1)'s limits — dropping `TypeConstraints` specifically also happened to be what it took to unblock a separate, recurring `"="`-vs-`AssignmentStatement` conflict that no `!greedy` placement fixed. |
| `PropertyAccessor`'s trailing `"(" ... ")"` is mandatory, not optional | A bare `get`/`set` with no parens at all isn't valid Kotlin anyway, and making it optional hit the same `statement+` wall as local classes. |
| Destructuring declarations, contracts, delegated-property edge cases (context receivers, annotation type arguments and annotated lambda parameters were later added — see PROGRESS.md) | Not attempted — out of scope for Phase 0, deferred by the original plan from the start, not discovered via a conflict. |

## Silent mis-parses (not caught by the generator)

Two real bugs survived a **conflict-free build** and were only caught by running the grammar
against real and synthetic `.kt` files afterward — the fatal-conflict list the generator produces
is necessary, not sufficient, evidence of a correct parser:

1. **`1..10` mis-tokenized as `1.` + `.10`.** `FloatingPointLiteral`'s dot-form allowed an optional
   digit after the decimal point (`digits "." digits?`), so maximal-munch tokenizing preferred the
   (invalid-in-real-Kotlin) bare-trailing-dot float over stopping at `1` and letting `..` be its
   own token. Fixed by requiring a digit after the dot, matching Kotlin's actual lexical rule
   (`1.` alone isn't valid; you need `1.0`).
2. **Extension functions** — see the scope-cut table above. Caught the same way: it built clean,
   then visibly produced garbage trees when fed `fun String.shout()`.

A third, more mundane bug of the same "clean build, wrong output" shape: `tokens.js`'s
`ContextTracker` compared shifted terms against `stringStart`/`stringStartTriple` imported from
the generated `parser.terms.js` — but Lezer only exports term constants for **capitalized** rule
names, so both imports were silently `undefined`, the context was never actually pushed, and the
external string-content tokenizer never engaged. `"x"` parsed as two empty string literals
sandwiching a bare identifier, no exception anywhere. Renamed to `StringStart`/`StringStartTriple`.
**Any external tokenizer or context tracker that references a grammar token by name from JS needs
that token capitalized**, independent of whether it should produce a visible tree node.

## Newline-separated statements (`Nl`) — 2026-09-21

The grammar originally treated newlines as plain whitespace (`;` was pure `@skip`), so two
statements in a row with no separator were indistinguishable from one statement continuing:
`Foo.a(1)` / `Bar.b(2)` collapsed into a single `InfixExpression` chain, and `Bar(1)` on the next
line parsed as a valid, error-free `ParenthesizedExpression` continuing the previous statement.
Three grammar attempts to fix this by giving `InfixExpression` its own same-line identifier token
failed (`@lezer/lr`'s default-reduce optimization reduces before any external tokenizer runs; see
PROGRESS.md "Attempts 1-3"), so call-edge extraction carried a tree-walking workaround
(`collectInfixMisparseEdges`).

The fix that worked is `@lezer/python`'s approach: an explicit statement-separator token on the
follow side, not a special operand token on the shift side. `nlTokens` (`tokens.js`) is an external
tokenizer, declared ahead of `@tokens`, that emits `Nl` for a line break or `;`:

- **Only where the automaton can shift it** (`stack.canShift(Nl)`). Line breaks inside call
  arguments and parentheses therefore stay insignificant with no bracket-depth tracking, and the
  existing string-template `ContextTracker` is untouched.
- **Not before a continuation token**: `.` (but not `..`), `?.`, `?:`, `&&`, `||`, `as`, `else`
  (but not a `when` branch's `else ->`), `catch`, `finally`. Comments between the break and the
  next token are skipped when peeking.
- **A `;` always separates.**

The grammar uses it in the three places a run of statement-like siblings has no leading keyword to
tell them apart: `Block` and `LambdaLiteral` (`stmts`), and `when` entries (`whenEntries`) —
brace-less branches (`A -> readA(1)` newline `B -> readB(2)`) otherwise swallowed the next entry's
condition as an infix operand, undercounting `WhenEntry` decision points in complexity. Class
bodies and top-level declarations were never affected, since every member starts with a keyword or
modifier.

Two smaller gaps fixed in the same pass, found by the corpus runs: trailing commas
(`commaSep`/`commaSep1` accept a trailing `","`), and `?: return`/`?: throw`/`?: continue`/
`?: break` (`Elvis`'s right operand accepts `jumpStatement`; the jump nodes stay statements
everywhere else to avoid a reduce/reduce against an expression-side duplicate).

**Measured** (error *nodes*, including zero-width recovery nodes, which an error-span ratio misses):

| Corpus | Before | After |
|---|---|---|
| OkHttp (573 files) error nodes / files with none | 19,526 / 60 | 3,991 / 270 |
| kotlinx.coroutines (1,039 files) error nodes / files with none | 18,055 / 173 | 8,809 / 414 |

Parse time is unchanged (~0.6 s per corpus). The remaining error mass in the worst files is the
documented cut list (at that point, overwhelmingly extension functions/properties and function types).

**Consequence for `collectInfixMisparseEdges`.** With the grammar fixed it recovers nothing real:
across both corpora it produced 0 genuine recoveries and 14 false-positive edges — 10 from
brace-less `when` branches (`TYPE_PING -> readPing(...)`, where an imported constant was read as a
qualifier; the `when` fix removed all 10) and 4 from labeled returns (`return@transform emit(v)`,
where an imported alias was read as a qualifier; still present, since `@label` is unsupported). The
earlier "no false positives demonstrated" claim held only for statement-list code. It was deleted
the same day; `@label` support is also worth retrying now that a bare `return` followed by a newline
and `@Foo` is no longer ambiguous.

## Extension receivers — 2026-09-21

Extension functions and properties were the most-hit gap: OkHttp has 223 extension functions and 19
properties, kotlinx.coroutines 757 and 51, and each one corrupted the parse of what followed it.

The fix is a flat receiver prefix, `(ReceiverSegment ("." | SafeNav))* Definition`, in both
`FunctionDeclaration` and `PropertyDeclaration`, where `ReceiverSegment { Identifier (<type args>)? }`.
Two design points, both found by trying the obvious approach first:

- **No wrapper node.** A `ReceiverType { simpleType }` wrapper built the ADR's original way parses
  without a build error and silently mis-parses: `ScopedTypeName` reduces `String.f` whole, leaving
  nothing for `Definition`. The receiver is instead several sibling `ReceiverSegment` nodes, so the
  declaration's only direct-child `Definition` is still its own name and every consumer that reads
  `getChild("Definition")` works unchanged. Extension functions are therefore named by that bare
  name (`commonName`, not `Headers.commonName`), matching how the line scanner already exports them.
- **`SafeNav` is a separator.** `Foo?.f` tokenizes as `Foo` `?.` `f`, never `?` then `.`, so a
  nullable receiver needs no `?` of its own.

No external tokenizer was needed: the fallback (a lookahead marker token, as for `Nl`) stayed unused.

**Measured** (error span ratio / error nodes / files with no error nodes):

| Corpus | Before | After |
|---|---|---|
| OkHttp | 0.238% / 3,991 / 270 | 0.113% / 3,615 / 297 |
| kotlinx.coroutines | 0.600% / 8,809 / 414 | 0.229% / 8,072 / 474 |

A handful of files show *more* error nodes afterwards (e.g. `Combine.kt` 38 → 64): the extension
header now parses and recovery reaches the next unsupported construct (a receiver function type in
a parameter, `return@let`) instead of being derailed earlier.

## Function types — 2026-09-21

`suspend () -> T`, `Foo.() -> Unit`, `suspend FlowCollector<R>.(T) -> Unit`, `(() -> Unit)?`,
named parameters (`(timeout: Int) -> Unit`) and extensions on function types
(`fun (suspend () -> T).run()`) were all errors. kotlinx.coroutines has 304 `: suspend …` types, 186
plain and 164 `suspend` receiver function types, 40 named-parameter and 24 nullable function types,
across ~150 of its 1,039 files; OkHttp has about 10. Three pieces, all in the type grammar:

1. **One production for function and parenthesized types.** `FunctionType { suspend? (recv ".")?
   "(" commaSep<functionParam> ")" (!greedy "->" type)? }` — the same `(` starts both, and only the
   arrow tells them apart, so the arrow is optional. No arrow = a parenthesized type, which is what
   makes `(() -> Unit)?` work (`NullableType { (simpleType | FunctionType) !greedy "?" }`). Two
   `!greedy`s carry Kotlin's own semantics: `() -> Unit?` returns a nullable `Unit` (the `?`
   attaches to the return type), and in `{ x: (Int) -> Int -> x }` the first arrow belongs to the
   function type, the second to the lambda.
2. **Receiver function types.** `FunctionType` begins with `(TypeName | ScopedTypeName |
   GenericType) "."` — the same nonterminals `ScopedTypeName` uses — rather than `simpleType`. The
   old comment blamed a conflict with navigation `.`; the real cause was reducing to `simpleType`
   before the `.`, which conflicts with `ScopedTypeName` shifting it. With the same prefix both
   shift the `.`, and the next token (`(` versus an identifier) chooses. No lookahead-marker
   tokenizer was needed.
3. **`ParenReceiver { "(" type ")" }`** before an extension declaration's receiver segments. The
   first attempt reused `FunctionType` there and hit a reduce/reduce against `ReceiverSegment`
   (FunctionType can now start with an identifier); after `fun`, a `(` can only start a
   `ParenReceiver`, so a dedicated rule needs no lookahead.

A stale grammar comment claimed a nullable function type "gets its own rule"; no such rule
existed and `(() -> Unit)?` errored. Removed.

**Verified beyond a clean build:** 28 type shapes in three positions (parameter, `val`, return
type), 17 context shapes (`is`/`as?`/`!is`, lambda parameters, generics, defaults), and tree
shapes for the tricky ones — 0 errors and the right structure, with `Foo.Bar`, `Foo<A>.Bar` and
`Map<String, List<Int>>` unchanged.

**Measured** (error span / error nodes / files with no error nodes):

| Corpus | Before | After |
|---|---|---|
| OkHttp | 0.113% / 3,615 / 297 | 0.113% / 3,600 / 298 |
| kotlinx.coroutines | 0.229% / 8,072 / 474 | 0.183% / 6,035 / 536 |

Coroutines error nodes fall by a quarter; OkHttp barely moves, as expected. A few files show *more*
nodes (`SafeCollector.common.kt` 30 → 69): the function-type header now parses and recovery reaches
the next unsupported construct — star projections (`SafeCollector<*>.f`), explicit call type
arguments (`emptyList<Proxy>()`) and labels (`fold@{`) — not a regression.

## Build-and-runtime module-format mismatches

Two mismatches specific to this project's `"type": "commonjs"` setting (most Lezer grammar
tutorials assume ESM):

- `buildParserFile`'s default `moduleStyle: "es"` produces `export const parser = ...`, which
  throws a `SyntaxError` at `require()` time — Node decides CJS-vs-ESM per file from the nearest
  `package.json`, ignoring the file's actual syntax. Switched to `moduleStyle: "cjs"`; converted
  the hand-written `tokens.js` from `import`/`export` to `require`/`module.exports` to match.
- `@external tokens .../ @context ... from "path"` resolves at two different times against two
  different base directories that don't agree: at *build* time, `buildParserFile` reads the file
  relative to `kotlin.grammar` itself (where `tokens.js` actually lives); but the generator copies
  that same literal path string into the generated output's own `require(...)` line, and that
  output lives in `generated/`, one directory deeper. Resolved by having the build script copy
  `tokens.js` into `generated/` after every build, so `generated/` is self-contained; the canonical
  `src/parser/lang/kotlin/tokens.js` is therefore a build-time source only, never required in
  place (documented in the file itself).

## Consequences

**Positive**

- Kotlin gets a real, pure-JS parse tree with no native code and no async init — Phase 1/2 can now
  build complexity, cognitive complexity, and call edges the same way Go/Java/Python already do.
- Zero error nodes against the `example/full-house/jvm/` fixtures and a broad synthetic test
  matrix (interpolation, `when`, ranges, generics with `where` constraints, sealed classes,
  try/catch, enum classes, nested local functions, secondary constructors, and more).
- The scope-cut list is a known, documented, bounded gap — not a silent one — should a real `.kt`
  file hit it (`find_symbol`/`get_module_responsibility` on the file will show it as `type:
  "kotlin"` parsed via this grammar either way; a construct outside the cut list surfaces as
  Lezer error nodes in the tree, not a crash).

**Negative / trade-offs**

- **No explicit call type arguments** (`emptyList<Proxy>()`, `arrayOfNulls<Any>(n)`) and **no star
  projections** (`List<*>`) — now the largest known gaps (458 / 1,549 call-type-argument lines and
  38 / 361 star-projection lines in OkHttp / kotlinx.coroutines). `arrayOfNulls<Any>(n)` silently
  parses as chained comparisons, with no error node.
- The grammar is meaningfully more restrictive than real Kotlin in several corners (see the cut
  table) — this is a parser for mokosh's specific needs, not a general-purpose Kotlin frontend.
- Two of the cuts (local classes, mandatory `PropertyAccessor` parens) exist purely because of a
  generator limitation (`statement+` internal grouping has no reachable precedence hook), not
  because the underlying Kotlin construct is actually ambiguous — a future Lezer version or a
  differently-structured grammar might remove the need for them.
- One more first-party grammar to maintain (`kotlin.grammar` plus its external tokenizer), on top
  of the existing per-language parsers, complexity extractors, and duplication tokenizer.

## Same-package call-edge resolution (2026-10-01)

Phase 1's call-edge extraction (`collectCallEdges` in `src/parser/complexity/kotlin.ts`) only ever
resolved a call whose name/qualifier had a `localNames` entry — built purely from the file's own
`import` lines. A bare call to a same-package sibling needs no `import` in Kotlin, so that class of
call (the single most common cross-file call shape in idiomatic Kotlin — see
`docs/known_issues/12-call-edge-same-package-resolution.md`) produced no call edge at all, with no
distinguishing signal from a genuinely unresolvable call.

Fixed without touching the grammar: a bare-call miss now emits a `RawCallEdge` carrying a
NUL-prefixed sentinel marker (`jvmSamePackageCallSpecifier`, `src/parser/lang/jvm-scan.ts`, mirroring
`GO_SAME_PACKAGE_SPECIFIER`'s convention) instead of being dropped, with no parse-time filter — every
miss defers, including stdlib calls (`println`, `let`, `map`, …; a synthetic stdlib-call-heavy
fixture produced one deferred marker per call site, a flat, linear cost, not a blowup). A new
builder-level post-drain pass (`GraphBuilder.resolveJvmSamePackageCallEdges`, after
`processTestFiles`/`processDocFiles` — the same reason those two are deferred: a file's siblings may
not exist in the graph yet while the wavefront is still draining) groups every already-parsed JVM
`FileNode` by `(declared package, module, source-root)` — reusing `jvmPathPartition`
(`src/graph/lang-resolvers/jvm.ts`), not a new index — and resolves each marker against the matching
partition's `FileNode.exports`. Exactly one match becomes a `CallEdge`; zero or more than one is
dropped silently, consistent with the resolver's own "no match → external" convention and issue 13's
disambiguation stance. Java's gap turned out to need the identical mechanism, just triggered by an
unqualified *type* reference (`Foo.bar()` / `new Foo()`) instead of a bare function call — see
`src/parser/lang/java.ts`'s `collectRawCallEdges`.

Caveat carried forward: on an incremental build, a cache-hit file's previously-resolved
same-package call edges stay frozen if a sibling is added/removed/renamed without the calling file
itself changing — surfaces only outside a full rebuild (fresh clone, CI, `--clear-cache`).

## Next steps

Phases 1 (hybrid integration + call edges) and 2 (complexity) have shipped, the conformance baseline
is in place, and the temporary tree-walking workaround (`collectInfixMisparseEdges`) has been
removed. What remains is grammar coverage growth: explicit call type arguments, star projections and
`@label` first. See
`src/parser/lang/kotlin/PROGRESS.md` for the detailed history.
