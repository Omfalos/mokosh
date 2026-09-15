# ADR-021: A First-Party Kotlin Lezer Grammar

**Date:** 2026-09-15
**Status:** Accepted — Phase 0 implemented (grammar builds, parses real Kotlin correctly); Phase 1/2 (integration, complexity, call edges) not started.

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
`typecheck`, which runs before `build`. `npm run verify:grammar` (`--verify`, diff a fresh rebuild
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
| No extension functions or properties (`fun String.shout()`, `val String.foo get() = ...`) | The receiver-type prefix's leading identifier reduces, at the same LALR state, to either `Identifier` (start of the receiver type) or `Definition` (the declaration's own name with no receiver) — a genuine reduce/reduce conflict from state-merging, since both are structurally identical one-token productions. For `PropertyDeclaration` this is a **hard build-time error**; for `FunctionDeclaration` the identical root cause does **not** error at build time — it silently mis-parses instead (`fun Foo.bar()` reduces `Foo.bar` whole as a `ScopedTypeName`, leaving nothing for the function name). The most commonly-hit gap in this list — extension functions/properties are idiomatic, everyday Kotlin. |
| No annotation-argument support (`@Foo(bar = 1)`, just `@Foo`) | Pulling `expression` into the modifier soup that prefixes nearly every declaration exploded the LR automaton. |
| No bare parenthesized type `(Foo)` | Would stay ambiguous with `FunctionType`'s own `"(" commaSep<type> ")" "->" type` until *after* the closing paren; LR(1) can't defer that reduction past the shared prefix. The one common real pattern needing parens — a nullable function type, `(() -> Unit)?` — gets its own rule instead. |
| No receiver-qualified function type (`Foo.() -> Unit`) | Shares a prefix with plain navigation (`baseExpression "."`), producing a spurious conflict wherever a `type` position is reachable from inside a larger expression. |
| No modifiers directly before `constructor`/`get`/`set` (`private constructor(...)`, `private set` still parse — the modifier just doesn't attach) | A modifier there is ambiguous against the *next* sibling declaration's own modifier soup, since the constructor/accessor is an optional trailing piece, not a repetition alternative. |
| No qualified or generic callable references (only bare `Foo::bar` / `::bar`) | Using `simpleType?` instead of a bare `Identifier` would make `TypeName` and `baseExpression`'s own `Identifier` alt reduce-reduce-ambiguous on every bare identifier. |
| No `@label` support at all (`return@x`/`break@x`/`continue@x`) | Without newline-sensitivity, a bare `return`/`break`/`continue` immediately followed by `@` is ambiguous between "this statement's own label" and "an annotation starting the next statement" — kept resisting `!greedy` resolution via a deep interaction with `CallableReference`. Labeled non-local jumps (common inside lambdas passed to `forEach` etc.) are a real, moderately common gap. |
| No local (nested-in-function-body) class declarations | Hits the generator's own internal `statement+ -> statement+ statement+` grouping (its binary splitting of `statement*` for incremental reparsing) — no precedence marker reaches a conflict whose competing side is generator-internal rather than a sibling rule this grammar controls. |
| Local functions and local properties use narrower dedicated rules (`LocalFunctionDeclaration`, `LocalPropertyDeclaration`), not the full `FunctionDeclaration`/`PropertyDeclaration` | Same `statement+` wall as local classes, but sidestepped instead of cut outright: a local function's body is never actually optional in real Kotlin, so requiring it removes the "reduce without a body" path the wall was blocking. Local properties additionally can't have accessors, type parameters, or type constraints in real Kotlin anyway, so the narrower rule matches the language, not just LR(1)'s limits — dropping `TypeConstraints` specifically also happened to be what it took to unblock a separate, recurring `"="`-vs-`AssignmentStatement` conflict that no `!greedy` placement fixed. |
| `PropertyAccessor`'s trailing `"(" ... ")"` is mandatory, not optional | A bare `get`/`set` with no parens at all isn't valid Kotlin anyway, and making it optional hit the same `statement+` wall as local classes. |
| Destructuring declarations, contracts, context receivers, delegated-property edge cases | Not attempted — out of scope for Phase 0, deferred by the original plan from the start, not discovered via a conflict. |

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

- **No extension functions or properties** — likely the single most commonly-hit gap, since
  they're idiomatic Kotlin. A `.kt` file leaning heavily on extension-oriented style (common in
  Kotlin stdlib-adjacent code, e.g. OkHttp-style codebases) will show more error nodes than one
  that doesn't.
- The grammar is meaningfully more restrictive than real Kotlin in several corners (see the cut
  table) — this is a parser for mokosh's specific needs, not a general-purpose Kotlin frontend.
- Two of the cuts (local classes, mandatory `PropertyAccessor` parens) exist purely because of a
  generator limitation (`statement+` internal grouping has no reachable precedence hook), not
  because the underlying Kotlin construct is actually ambiguous — a future Lezer version or a
  differently-structured grammar might remove the need for them.
- One more first-party grammar to maintain (`kotlin.grammar` plus its external tokenizer), on top
  of the existing per-language parsers, complexity extractors, and duplication tokenizer.

## Next steps (Phase 1/2, not started)

Hybrid integration into `src/parser/lang/kotlin.ts` (replacing the ADR-017 scanner's parse layer
while keeping its resolver/classification behavior), then complexity + cognitive complexity +
call-edge extraction mirroring `src/parser/complexity/go.ts` / `java.ts`, then a conformance
baseline. See `src/parser/lang/kotlin/PROGRESS.md` for the detailed resume plan.
