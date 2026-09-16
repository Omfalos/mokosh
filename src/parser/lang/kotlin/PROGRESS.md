# Kotlin grammar — progress snapshot

Resume point for the "first-party Kotlin Lezer grammar" work (plan name: **"Kotlin support: call
edges + complexity via a first-party Lezer grammar"**, saved at
`/Users/karolmachulski/.claude/plans/gleaming-petting-goose.md` — see that file for the full
multi-phase plan).
Phases 0 (grammar + build step + ADR), 1 (hybrid integration + call edges), and 2 (complexity) are
all **shipped**. Remaining work is Phase 0b (grammar coverage growth, as-needed) — see "How to
resume" at the bottom.

## Status: grammar builds clean and parses real Kotlin correctly

Not committed to git — `git status` still shows `src/parser/lang/kotlin/` and
`scripts/build-kotlin-grammar.mjs` as untracked, `package.json`/`package-lock.json` modified
(new deps).

- `node --max-old-space-size=8192 scripts/build-kotlin-grammar.mjs` builds clean (exit 0). The
  entire `generated/` directory is a **gitignored build artifact**
  (`/src/parser/lang/kotlin/generated/` in `.gitignore`, nothing hand-written inside it) —
  `build:grammar` is chained into `npm run build`/`build:prod`, and CI runs it explicitly before
  typecheck (which runs before `build`) in both `ci.yml` and `release.yml`. `--verify` (diff a
  fresh rebuild against whatever's currently on disk in `generated/`) is a local reproducibility
  check, not a CI drift gate — there's no committed baseline to drift from anymore.
- `node scripts/kotlin-grammar-smoke-test.mjs <file.kt>...` (throwaway sanity script, not wired
  into the real parser) reports 0 error nodes against all three `example/full-house/jvm/`
  fixture files and a broad set of synthetic snippets covering: string interpolation (simple
  `$x` and `${expr}`, including a lambda with its own braces inside an interpolation),
  triple-quoted strings, `when` expressions, `for`/`while`/`do-while`, ranges (`1..10`), data
  classes, companion objects (including functions inside them), null-safety (`?.`/`?:`),
  try/catch/finally, generic classes with `where` constraints, sealed classes, trailing-lambda
  chains, float literals, qualified type annotations, uninitialized local `var`, nested local
  functions, interface method declarations (no body), enum classes (plain, with constructor
  args, with members after entries, and with a per-entry class body override), and secondary
  constructors.

## What's done

- **Dependencies installed**: `@lezer/generator` (devDependency), `@lezer/common` and `@lezer/lr`
  promoted to direct `dependencies`.
- **`src/parser/lang/kotlin/kotlin.grammar`** — first-party grammar (informed by, not copied
  from, JetBrains' `kotlin-spec` — that's an ANTLR4 grammar, a fundamentally different parsing
  model from Lezer's static LR(1) automaton, so a direct port was never on the table; see
  "Why not kotlin-spec" below). Covers: package/import headers, class/interface/object/companion
  object declarations, primary/secondary constructors, init blocks, functions, properties with
  get/set accessors, typealias, if/when/try as expressions, for/while/do-while/return/break/
  continue/throw statements, enum classes (entries with optional ctor args and per-entry class
  bodies), a fairly complete expression grammar (binary ops with real Kotlin precedence, ranges,
  infix functions, is/as, prefix ops, lambdas, call expressions incl. trailing lambdas,
  navigation `.`/`?.`, indexing, `!!`, bare callable references `Foo::bar`), and
  Python-FormatString-style string templates via a real external tokenizer + ContextTracker.
- **`src/parser/lang/kotlin/tokens.js`** — external tokenizer + `ContextTracker` for string
  templates (`stringTokens`, `trackStrings`), CommonJS (see module-format note below).
- **`scripts/build-kotlin-grammar.mjs`** — wraps `@lezer/generator`'s `buildParserFile`
  (`moduleStyle: "cjs"` — see below); supports plain regenerate and `--verify` (diff against a
  temp rebuild). Also copies `tokens.js` into `generated/` after each build (see below). Wired
  into `package.json` as `build:grammar` / `verify:grammar`.
- **`src/parser/lang/kotlin/index.ts`** — `require()`s the generated parser and annotates it with
  `LRParser` inline (`const { parser } = require("./generated/parser.js") as { parser: LRParser }`)
  rather than a type-checked `export ... from` re-export, specifically so nothing hand-written has
  to live inside `generated/` (that directory is wholesale gitignored — see below — and an earlier
  version of this file kept a hand-written `parser.d.ts` there purely to satisfy `tsc`, which was
  a real inconsistency: a gitignored-as-pure-build-output directory silently depending on one
  tracked file living inside it). Not yet used by anything else (Phase 1 not started).
- **`scripts/kotlin-grammar-smoke-test.mjs`** — throwaway sanity script (see Status above).
- Deliberate scope cuts made and documented inline in the grammar (each has a comment explaining
  why, citing the LR conflict — or, in two cases, a *silent mis-parse* — it caused):
  - No annotation-argument support (`@Foo(bar=1)` — just `@Foo`).
  - No bare parenthesized type `(Foo)`.
  - No receiver-qualified function type (`Foo.() -> Unit`).
  - **No extension functions or extension properties at all**
    (`fun String.shout()`, `val String.foo get() = ...`) — the receiver-type prefix hits an
    Identifier-vs-Definition LALR state-merge ambiguity. For `PropertyDeclaration` this is a hard
    build-time reduce/reduce (caught immediately); for `FunctionDeclaration` the *exact same*
    root cause does **not** error at build time — it silently mis-parses instead (`fun
    Foo.bar()` swallows `Foo.bar` whole as a `ScopedTypeName`, leaving nothing for the function
    name, then cascades into garbage error-recovery for everything after). This was only caught
    by testing against real/synthetic `.kt` files, not by the generator — a reminder that a
    clean build here is necessary but not sufficient; always spot-check output trees for
    constructs the fatal-conflict list didn't happen to cover.
  - No modifiers directly before `constructor`/`get`/`set`.
  - No qualified or generic callable references (only bare `Foo::bar`/`::bar`).
  - No `@label` support at all for `return@x`/`break@x`/`continue@x`.
  - No destructuring/contracts/context receivers/delegated-property edge cases.
  - **No local (nested-in-function-body) class or function declarations** — both hit the
    generator's own internal `statement+ -> statement+ statement+` grouping (its binary
    splitting of `statement*` for incremental reparsing) with no precedence hook reachable from
    grammar-level markers; `LocalFunctionDeclaration` sidesteps it for functions by requiring
    `functionBody` (never actually optional for a *local* function in real Kotlin anyway), but
    no equivalent trick was found for local classes, so they're simply unsupported.
    `LocalPropertyDeclaration` additionally drops `PropertyAccessor`/`TypeParameters`/
    `TypeConstraints` (none of which apply to local variables in real Kotlin anyway) — dropping
    `TypeConstraints` specifically also happened to be what it took to unblock a separate,
    recurring `"="`-vs-`AssignmentStatement` conflict that no amount of `!greedy` placement
    fixed.
  - `PropertyAccessor`'s trailing `"(" ... ")"` is mandatory, not optional — a bare `get`/`set`
    with no parens isn't valid Kotlin anyway, and making it optional hit the same unfixable
    `statement+` wall as above.
- **Established conflict-resolution patterns**:
  - `!greedy` precedence (declared in `@precedence`) on an optional/repeated piece whose first
    token overlaps the *next* sibling's start-token set, to always prefer attaching. Used
    ~10 times. Placement matters and isn't always predictable: sometimes the outer
    `(!greedy X)?` wrapper suffices, sometimes the marker also needs to sit on `X`'s own entry
    token(s) directly (`PropertyAccessor`'s `ckw<"get">`/`ckw<"set">`), and sometimes it needs to
    be split across every alternative individually rather than wrapping the whole group
    (`PropertyDeclaration`'s `!greedy "=" expression | !greedy ckw<"by"> expression`). When a
    conflict persists after marking, try each of these placements before concluding the conflict
    needs a structural fix instead.
  - `!postfix` for expression postfix-chain ambiguities (call/navigation/indexing vs. reducing
    `baseExpression` early).
  - Deleting a redundant dual-representation rule instead of trying to force disambiguation, when
    two different node types would otherwise compete for the *identical* production shape (e.g.
    `IfStatement` vs `IfExpression`; later, `Block` vs a bare `LambdaLiteral` in `controlBody` —
    fixed by excluding `LambdaLiteral` from being reachable as a standalone `ExpressionStatement`,
    since real Kotlin never treats a bare `{ ... }` as its own statement anyway).
  - **`dynamicPrecedence` does not resolve shift/reduce conflicts** — only `!greedy`/named
    `@precedence` tokens do. `dynamicPrecedence` is for ranking otherwise-valid alternative
    *reductions* (reduce/reduce-shaped ambiguity), not for telling the automaton whether to shift
    or reduce. Wasted a round discovering this the hard way (marked both `Block` and
    `LambdaLiteral` with opposite `dynamicPrecedence` for a conflict that was actually
    shift/reduce underneath — had no effect).
  - Some conflicts have **no available precedence hook at all** because the competing reduction
    comes from the generator's own internal `statement+ -> statement+ statement+` grouping, not
    from a sibling rule this grammar controls. When you see that exact phrase in a conflict's
    "allowed because of this rule" explanation, stop trying `!greedy` — either restructure to
    remove the optionality that creates the ambiguity (require what's grammatically required
    anyway), or cut the construct from statement position entirely.
  - **A clean build is not proof of a correct parse.** Two real bugs (the `1..10` range
    mis-tokenizing as `1.` + `.10`, and extension functions mis-parsing silently) survived a
    conflict-free build and were only caught by actually parsing real/synthetic `.kt` files
    afterward. Always run the smoke test — with a deliberately broad set of snippets, not just
    the files at hand — after any build that goes green.
  - Tokenizer-level (not parser-level) conflicts are a separate error class
    (`"Overlapping tokens X and Y used in same context"`), fixed the same way as the
    pre-existing `Asterisk`-vs-comment cases: an explicit `@precedence { Y, X }` inside `@tokens`.
    Hit this for `LineComment` vs `"/"` and `FloatingPointLiteral` vs `"."`.
  - Lowercase rule names (`stringStart`, `whitespace`, ...) don't get exported term constants by
    Lezer by convention — only capitalized names do. This bit us for real: `tokens.js`'s
    `ContextTracker` compared against `stringStart`/`stringStartTriple` (lowercase in the
    grammar), which imported as `undefined` from `parser.terms.js`, so the context was *never
    actually pushed* — the external string tokenizer silently never engaged, and `"x"` parsed as
    two empty string literals sandwiching a bare identifier. No build error, no exception —
    just wrong output. Renamed both to `StringStart`/`StringStartTriple`. **If an external
    tokenizer or context tracker ever needs to reference a token by name from JS, that token's
    grammar name must be capitalized**, regardless of whether you want it to produce a visible
    tree node.
  - **Module format must match the whole project's, not `@lezer/generator`'s default.** mokosh is
    `"type": "commonjs"` (tsconfig `"module": "nodenext"` compiles `.ts` to CJS for that reason).
    `buildParserFile`'s default `moduleStyle: "es"` produces `export const parser = ...`, which
    fails at runtime with a `SyntaxError` when `require()`d (Node picks CJS-vs-ESM per-file from the
    nearest `package.json`, ignoring the file's actual syntax). Switched to `moduleStyle: "cjs"`.
    `tokens.js` (hand-written, not generated) needed the same treatment: converted from
    `import`/`export` to `require`/`module.exports`.
  - **`@external tokens .../ @context ... from "path"` resolves at two different times against
    two different base directories, and they don't agree.** At *build* time, `buildParserFile`
    needs to actually read the external file relative to the `.grammar` file's own location
    (`tokens.js` is a sibling of `kotlin.grammar`, so `"./tokens.js"` is correct there). But the
    generator copies that literal string into the generated output's own `require(...)`/`import`
    line unchanged — and that output lives in `generated/`, one directory *deeper* than
    `tokens.js`, so the same `"./tokens.js"` string is wrong at *runtime*. There's no single path
    string that's correct in both places while `generated/` is a subdirectory. Resolved by having
    the build script copy `tokens.js` into `generated/` after every build, so `generated/`
    becomes self-contained; the canonical `src/parser/lang/kotlin/tokens.js` is therefore only
    ever used as a build-time source, never required in place (documented with a comment in the
    file itself, since its own `require("./parser.terms.js")` is only valid from the copy).
  - `";"` can never appear as a literal token in a rule — it's declared in the global `@skip`
    block (this grammar has no ASI), so any place you might want to explicitly check for it
    (e.g. the `;` separating enum entries from regular class members) needs no explicit token at
    all: it's already invisible there, same as anywhere else.

## Why not just use kotlin-spec (JetBrains' official grammar)?

`kotlin-spec` is an **ANTLR4** grammar — adaptive LL(*) parsing with semantic predicates and
runtime backtracking. Lezer builds a **static LR(1)-style automaton** at build time and refuses
outright if the grammar is ambiguous (every `GenError` in this file). The two have incompatible
disambiguation models; there's no mechanical port. A straight port of the *full* spec (contracts,
destructuring, context receivers, DSL receiver types, the works) would hit far more of these
conflicts than this deliberately narrow grammar, for coverage mokosh doesn't need — the actual
requirement is declaration/function boundaries and call-expression shapes for complexity/call-edge
extraction, not full Kotlin fidelity. kotlin-spec was used as the *reference* for correct Kotlin
structure while authoring this grammar fresh, directly in Lezer's DSL, scoped down from the start
— the same relationship the already-installed `@lezer/python` and `@lezer/java` have to their own
"official" grammars.

## Phase 0 is now complete

All of Phase 0's remaining items are done:

- `package.json` — `build:grammar` / `verify:grammar` scripts wired up.
- `biome.json` — excludes `src/parser/lang/kotlin/generated/`.
- `docs/adr-021-kotlin-parsing.md` — written, covering the full decision history (including why
  not kotlin-spec) and the scope-cut list.
- `src/parser/lang/kotlin/index.ts` types the generated (untyped) `parser.js` via an inline
  `require()` + cast rather than a hand-written `.d.ts` living inside the gitignored `generated/`
  directory, so `npm run typecheck` passes without anything tracked inside a directory whose
  entire purpose is build output.

## Phase 1 — in progress (2026-09-15), paused on a real grammar bug

**Phase 0's original "How to resume" step 1 (broaden the smoke test against a real corpus) is
done**: `scripts/kotlin-corpus-gate.mjs <corpus-dir> [--top N]` (committed) parses every `.kt`
file under a directory and reports the error-node-span ratio + wall-clock time — this is the
plan's go/no-go gate. Run against a local checkout of OkHttp (`../okhttp`, 573 files): **overall
error-span ratio 1.02%**, 0 hard parse exceptions, every worst-offender file hand-checked back to
a documented Phase 0 scope cut (extension functions/properties, `@file:` annotation args). **Gate
verdict: PASS** — this is what justified starting Phase 1's hybrid integration.

### What's implemented and kept (typechecks, existing tests pass)

- `src/parser/complexity/lezer-utils.ts` — added `errorRatio(tree, content)`, the shared
  error-node-span-ratio helper (Phase 2's complexity skip-gate will reuse this too).
- `src/parser/complexity/kotlin.ts` (new) — `collectCallEdges(tree, content, localNames)`: walks
  every `FunctionDeclaration`/`SecondaryConstructor` body plus class/object/companion-object
  superclass delegation lists. Emits qualified calls (`Core.shout(x)`, incl. `?.`), bare
  capitalized-initial calls resolved as constructor calls (`"new"`, no `new` keyword in Kotlin),
  and superclass-constructor calls — mirrors `java.ts`'s scope (imported/aliased names only, no
  locals, no virtual dispatch, no multi-level qualifiers). **The logic here is correct for what it
  can see** — the problem (below) is a grammar-level input problem, not a bug in this file.
- `src/parser/lang/kotlin.ts` — hybrid wiring: the line-scanner is untouched (imports/exports/
  tags/category identical to before); additively parses the tree, gates on
  `errorRatio <= 0.05`, and calls `collectCallEdges` when the gate passes and `category !== "test"`.
  Also now captures each import line's optional `as <alias>` (previously dropped) into a
  parse-local `localNames: Map<string, string>` (simple/aliased name → FQN) used only for
  call-edge resolution — `ImportEdge.symbols` itself is intentionally unchanged (still drops the
  alias, per the JVM-wide convention in `jvm-scan.ts`).

### What's deliberately *not* done yet

`src/graph/language-support.ts` (`CALL_EDGE_TYPES`, `LANGUAGE_FIDELITY.kotlin.callEdges`,
`FIDELITY_CAVEAT.kotlin.callEdges`), `docs/language-support.md`, `src/parser/lang/
kotlin.call-edges.test.ts`, and the `example/full-house` conformance regen are all **intentionally
withheld** — shipping the fidelity flip now would overstate real coverage given the bug below.

### The bug: consecutive bare-call statements collapse into one garbage `InfixExpression`

This grammar has **no ASI and no newline-sensitivity** (`;` is pure `@skip` whitespace, newlines
are never distinguished from spaces — see the "no ASI" notes already in `kotlin.grammar`).
`InfixExpression { expression !infixFn Identifier expression }` is the *only* `expression`
alternative whose own operator is a bare `Identifier` rather than punctuation/a keyword — every
other alternative (`BinaryExpression`, `RangeExpression`, `IsExpression`, etc.) uses a distinct
token that can't be confused with the start of a new statement. With no separator and no
newline-sensitivity, the parser cannot tell "the current statement continues, using this
identifier as an infix function name" from "a new statement starts here" — and it deterministically
picks the former, every time, with no build-time conflict ever reported (there's nothing telling
it otherwise, so there's nothing to flag).

Confirmed empirically:
```kotlin
Foo.stat(1)
Bar.other(2)
Baz.third(3)
```
parses as one `InfixExpression` chain — only `Foo.stat`'s edge survives; `Bar.other`/`Baz.third`
both lose their qualifier (reduced to bare lowercase calls, `add`-shaped, filtered out by
`collectCallEdges`'s capitalized-bare-call heuristic) and disappear. A bare constructor call as
the second statement (`Foo.stat(1)` then `Bar()`) is swallowed with **no recovered node at all** —
the edge vanishes entirely. **Important: every tested case was a false negative (missing edge),
never a false positive (fabricated edge)** — `collectCallEdges`'s existing filters (qualifier must
resolve via `localNames`, bare calls must be capitalized-and-resolve) happen to suppress the
corrupted output either way. But the error-node-span ratio for the 3-statement case is only
**2.9%**, comfortably under the corpus gate's 5% threshold — this specific failure mode hides
inside a low overall char-ratio because it's a *systemic undercount*, not a *localized parse
failure*, and it's a very common Kotlin shape (any function with 2+ non-`val`/`return`/keyword-
prefixed statements in a row — sequential calls, builder-style code).

### Two fix attempts today, both reverted — grammar is back to the exact pre-session baseline

**Attempt 1 — parallel `statementExpression` rule excluding `InfixExpression`.** Gave
`ExpressionStatement` its own restricted copy of `expression`'s alternatives (everything except
`InfixExpression`). Failed at build time: `GenError: reduce/reduce conflict between
statementExpression -> baseExpression and expression -> baseExpression`. Root cause: several of
`expression`'s alternatives (`AsExpression`, `IsExpression`, `PrefixExpression`, ...) reference
`expression` *recursively* inside their own bodies, and `baseExpression` (and friends) are
low-level *inlined* rules — Lezer doesn't duplicate the node types they produce per calling
context, so a token sequence reachable through `statementExpression`'s copy and reachable through
plain `expression` collapse onto the exact same node type with no way to tell which "path"
produced it. Any fix along these lines needs the duplicated alternatives to produce genuinely
distinct node types too, not just a distinct top rule name — a much bigger, more invasive change.

**Attempt 2 — newline-aware external tokenizer.** Added `tokens.js`'s `infixFunctionName`
(`ExternalTokenizer`), using `input.peek(-N)` to scan backward through the trivia immediately
before an identifier for a crossed line break — the exact technique `@lezer/python`'s own
`newlines` tokenizer uses for indentation (confirmed by reading
`node_modules/@lezer/python/src/tokens.js` directly). Wired a new external term
`InfixFunctionName` into `InfixExpression` in place of plain `Identifier`, so only a *same-line*
identifier could satisfy it. **Built clean, zero conflicts reported.** But empirically: the
tokenizer was **never invoked at all** — confirmed by adding `console.error` logging inside it
and parsing files with hundreds of identifiers, including a same-line, non-statement-repetition
position (`assertThat(x shouldBe y)`, a call argument) — zero invocations anywhere, not just in
`statement*` positions. Net effect: `InfixExpression` became entirely unreachable (dead
production), which "fixed" the reported bug only as an accidental side effect of disabling *all*
infix-expression parsing — including legitimate same-line usage (`x shouldBe y`, a common Kotest
assertion idiom) which now silently mis-parses into three separate garbage statements instead.
**This is a worse regression than the original bug** (was: false negatives only; now: also
false-shaped trees with zero error signal for previously-correct code) and was reverted in full —
`kotlin.grammar` and `tokens.js` are back to byte-for-byte their pre-session state.

Why attempt 2's tokenizer is never invoked is **not understood** — ruled out the most obvious
theory (that this is the same "generator's own internal `statement+ -> statement+ statement+`
grouping, no precedence hook available" wall already documented above for local
classes/`PropertyAccessor`, since the call-argument test case isn't anywhere near a `statement*`
repetition and still failed identically). Plausible remaining theories, untested: (a) Lezer's
default shift/reduce conflict resolution treats a production reachable *only* via an external
tokenizer differently from one reachable via the built-in DFA in an ambiguous state — i.e. "prefer
shift" isn't the default when the shift target's only source is external; (b) something about
`identifier`'s role as the base for `@specialize`/`@extend` keyword tokens gives it automaton
properties (a "maximal munch" reachability, or per-state token set inclusion) that a wholly
separate external terminal doesn't get for free, even when declared to conflict at the same
position. Needs actual `@lezer/generator` documentation or an upstream question, not more blind
experimentation.

## Attempt 3 (2026-09-15) — also reverted; root cause of attempts 2 and 3 both found

Re-tried the newline-sensitivity fix with a fresh external token (`SameLineIdentifier`, same
backward-trivia-peek technique as attempt 2, swapped into `InfixExpression` in place of plain
`Identifier`). Build was clean, and the token *did* show up correctly in the generated automaton
this time (`parser.terms.js` assigned it a real term id, and it appeared in the generated
`tokenizers` array) — ruling out attempt 2's leading theory (a naming/casing mismatch silently
breaking the JS import).

It still never fired, and `LOG=parse` (built into `@lezer/lr`) made the actual cause visible:
right after the left operand reduces up to `expression`, the parser runs a chain of
**`always-reduce`** transitions (`@lezer/lr`'s `defaultReduce` optimization, `advanceStack` in
`dist/index.js`) straight through to completing the enclosing declaration/statement — a
single-action state reduces unconditionally *before even tokenizing*, so `SameLineIdentifier`'s
tokenizer never gets a chance to run, in any context, not just at a statement boundary. The old
shared `identifier` token kept that state multi-action (hence non-default-reduce) purely because
it was reachable from many other rules at that position; giving `InfixExpression` an *exclusive*
token changed which LALR states merge, and this specific state collapsed to single-action instead.
This is upstream of anything a grammar-level precedence marker (`!name`) can influence — confirmed
with `parser.stateSlot`/`hasAction`, not just theorized. Reverted grammar and `tokens.js` in full
again (see git history around this note if a fourth attempt is ever considered) — do not retry the
same "give InfixExpression's operand its own terminal" shape without first understanding whether
`@lezer/generator` has any way to suppress `defaultReduce` for a specific state, since three
separate encodings of that same idea have now failed for three different reasons.

## Phase 1 — shipped (2026-09-15), via a tree-walking fix instead of a grammar fix

After three grammar-level attempts each hit a different Lezer-automaton dead end, the actual fix
lives in `src/parser/complexity/kotlin.ts`'s `collectInfixMisparseEdges` instead: it recovers the
specific mis-nested shapes `InfixExpression`'s bare-call collapse produces (a qualified call whose
qualifier got demoted to the "operator" `Identifier` slot; a no-argument constructor call whose
`()` got swallowed as an empty, erroring `ParenthesizedExpression`) directly from the tree, gated
on `localNames` exactly like every other edge in that file so a genuine same-line infix expression
can't be misread as a qualified call. `CALL_EDGES_ENABLED` flipped to `true` in
`src/parser/lang/kotlin.ts`. A real, previously-untested bug in `collectSuperclassCallEdges` was
also caught and fixed by the new test file: it checked `DelegationSpecifiers`' direct children for
`ConstructorInvocation`, but the actual direct children are `DelegationSpecifier` wrapper nodes one
level up — the superclass-constructor-edge test in
`src/parser/lang/kotlin.call-edges.test.ts` would have failed silently (empty result, no error)
without that fix.

Remaining known gap (documented, not silently guessed at): a *with-arguments* constructor call
(`Bar(1)`) immediately following another statement with no separator still loses its edge — `(1)`
parses as a valid, error-free `ParenthesizedExpression` with no signal distinguishing it from a
real parenthesized expression, unlike the empty-parens case.

Closed out: `CALL_EDGE_TYPES`/`LANGUAGE_FIDELITY.kotlin.callEdges`/`FIDELITY_CAVEAT.kotlin.callEdges`
in `src/graph/language-support.ts` (now `"partial"`, matching Java's level), the
`docs/language-support.md` row + prose split (Kotlin now differs from Scala/Groovy), the dedicated
`kotlin.call-edges.test.ts`, and `UPDATE_CONFORMANCE=1` regeneration of the `example/full-house`
baseline (`Repositories.kt`'s `Core.shout(...)` aliased-import call now shows up: kotlin's
`withCallEdges` is 1/3).

## Phase 2 — shipped (2026-09-16)

`computeCyclomaticComplexity`/`computeCognitiveComplexity`/`collectFunctionComplexity` added to
`src/parser/complexity/kotlin.ts`, mirroring `complexity/java.ts`'s shape. Handles this grammar's
own quirks (documented inline in the file's module doc comment): `&&`/`||` surface as bare
literal-token nodes rather than a wrapping `LogicOp`-style node; `else if` reaches the tree one
level deeper than Java's shape (`ExpressionStatement > IfExpression`); every brace body —
including a plain `if`/`while`/`for`/`when` control-flow body — is tagged `LambdaLiteral`, not
`Block`, so a `isControlFlowBodyBrace` check excludes those from the closure-nesting penalty a
real lambda gets.

A **per-function** error gate (`!nodeHasError(body)`, zero-tolerance, not a percentage) was added
to `collectFunctionComplexity` specifically — motivated by a real OkHttp case
(`DiskLruCache.close`) where a file-wide error ratio stayed under 1% while that one function's body
alone was severely corrupted, inflating cyclomatic complexity from ~4 to 46. **This gate does not
apply to `collectCallEdges`** — an early draft added the same gate there too, which broke Phase 1's
`collectInfixMisparseEdges` recovery path (that function exists specifically to recover edges from
bodies *containing* error nodes, so a zero-tolerance gate silently zeroed out the two dedicated
regression tests for it). Caught by running the full suite after the gate helper was wired up; fixed
by scoping the gate to `collectFunctionComplexity` only. Lesson for any future per-node-type gate
in this file: check whether a recovery function downstream expects to see error nodes before
gating its caller on their absence.

Also fixed in the same pass: the gate helper was originally written against a function name
(`nodeErrorRatio`) that was never defined in `lezer-utils.ts` (only `errorRatio`, whole-tree, and
`nodeHasError`, boolean, exist) — a `ReferenceError` on every call, silently swallowed by
`kotlin.ts`'s failure-isolation try/catch, so `functions`/call edges both silently degraded to
`undefined`/regressed with no visible error. Caught by the qualified-method-naming test returning
`undefined` and the conformance baseline's `withCallEdges` dropping 1→0.

Closed out: `FUNCTION_COMPLEXITY_TYPES` gained `"kotlin"`, `LANGUAGE_FIDELITY.kotlin.complexity`
flipped `"none"`→`"partial"`, `FIDELITY_CAVEAT.kotlin.complexity` rewritten to describe the
error-density gate, `docs/language-support.md` + `docs/known_issues/08-cross-language-reliability.md`
+ `docs/plans/jvm-support-followups.md` updated, dedicated `kotlin.complexity.test.ts` (12 tests),
`example/full-house` conformance baseline regenerated. Full suite (`npm test`, 1810 tests) and
`npm run typecheck` both pass clean.

## Choice-count warnings fixed (2026-09-16)

`yarn build`'s grammar-generation step was printing two non-fatal `@lezer/generator` warnings:
`ClassDeclaration is generating a lot (128) of choices` and `PropertyDeclaration is generating a
lot (192) of choices` — a combinatorial-explosion advisory from the LR table builder, not a build
failure, caused by each rule chaining several independent optional (`?`) pieces after its own
`modifier*` prefix.

First attempt — capitalizing `modifier` → `Modifier` (so it gets its own tree node instead of
being inlined into every caller) — was tried on the theory that `modifier`'s 28-way keyword
alternation was being folded into each caller's choice count. It produced **zero change** (same
128/192 after rebuild), disproving that theory, and was reverted. The actual driver is the chain
of optional pieces within `ClassDeclaration`/`PropertyDeclaration` themselves, not `modifier`.

Fix that worked: pulled each rule's middle cluster of optional pieces into its own lowercase
(inlined, no new tree node) sub-rule — `classTail` (`PrimaryConstructor?`/`DelegationSpecifiers?`/
`TypeConstraints?`) and `propertyTail` (`(":" type)?`/`TypeConstraints?`). Both sub-rules already
match empty on their own, so no grammatical change — the parent rule just sees one slot for the
whole cluster instead of N independent binary choices, bounding the combinatorial product inside
the smaller sub-rule instead of multiplying it across the whole parent. Both warnings are gone
after rebuild; no new hard LR conflicts; full suite (`npm test`, 1810 tests) and `npm run
typecheck` both pass clean; `kotlin-grammar-smoke-test.mjs` against `example/full-house`'s three
.kt fixtures shows the same error-node counts as before the change (1 pre-existing error node in
`Repositories.kt`, confirmed present on the pre-change baseline too).

## Annotation-argument and use-site-target support (2026-09-16)

Dogfooding against a local square/okhttp checkout (`analyze()` + `find_complex_functions()` on the
`okhttp` package, 339 real `.kt` files) found complexity/call-edges silently skipped on 25/339
(~7.4%) — all above `ERROR_RATIO_THRESHOLD`. Root-caused via a throwaway error-ratio scan script
(not committed; `scripts/kotlin-corpus-gate.mjs` already does the same job for future use) plus
per-file error-node dumps: not 25 unrelated gaps, overwhelmingly one class of gap, compounded by
how @lezer's error recovery works.

**The two real gaps**, both already flagged in `annotationUse`'s old comment as deliberately cut:
1. `annotationUse` had zero support for annotation arguments (`@Foo(bar = 1)`) — matched only the
   name.
2. `annotationUse` only recognized `ckw<"file">` as a use-site target — `@get:`/`@set:`/`@param:`
   etc. (real Kotlin syntax, and OkHttp's standard idiom for exposing a constructor property under
   a JVM-friendly name, `@get:JvmName("x") val x: T`) didn't match at all.

**Why the damage was so disproportionate:** hitting either gap didn't just leave one small
unparsed span — @lezer's error recovery cascaded from that point until it could resynchronize,
corrupting everything after it. One file had a single `@file:OptIn(Foo::class)` line at the top
produce error nodes spanning its *entire* import block below. A third, previously-unknown gap
compounded this for every `@file:` case specifically: `@top Program` never had a leading
`annotationUse*` slot at all — `annotationUse` was only ever reachable via a declaration's
`modifier*`, never at `Program` level — so a leading `@file:X` failed to parse *even with no
arguments*, and its cascade corrupted the whole file, package line and all.

**Fix, in three isolated, individually-reverted-on-failure steps** (each rebuilt + full-suite +
`example/full-house` smoke-tested before the next):
1. `useSiteTarget { ckw<"file"> | ckw<"property"> | ckw<"field"> | ckw<"get"> | ckw<"set"> |
   ckw<"receiver"> | ckw<"param"> | ckw<"setparam"> | ckw<"delegate"> }` — the real Kotlin
   use-site-target list. `get`/`set` reuse the same `ckw<>` terminals `PropertyAccessor` already
   declares (no new terminals). Clean build alone; by itself barely moved the skip count (expected
   — still missing argument support).
2. `annotationUse { "@" (useSiteTarget ":")? dottedName (!greedy ArgumentList)? }` — reuses the
   existing `ArgumentList`/`callArgument` machinery already used by `ConstructorInvocation`/
   `EnumEntry`/`CallExpression`, gated by the same `!greedy` pattern this grammar uses at every
   other "optional trailing piece vs. next sibling" ambiguity. **Built clean on the first attempt**
   — the historical "pulling expression into the modifier soup exploded the automaton" note (see
   `annotationUse`'s old comment, kept below for context) evidently didn't apply with `!greedy` in
   place; this is worth remembering before assuming that note forecloses future modifier-soup work.
3. `@top Program { (!greedy annotationUse)* PackageHeader? ImportHeader* topLevelDeclaration* }` —
   gives `Program` its own leading annotation slot. First attempt (`annotationUse*`, no `!greedy`)
   hit an immediate hard `GenError` (reduce/reduce conflict between `modifier -> annotationUse` and
   `annotationUse+ -> annotationUse` — genuinely ambiguous which repetition a leading `@...`
   belongs to). Adding `!greedy` — the same fix pattern as step 2 — resolved it clean on the retry.

**Result:** skipped-file count on the okhttp corpus dropped from 25/339 to **0/339**; overall
error-span ratio 1.26% → 0.46%; fully-clean-parse files 68/339 (20%) → 96/339 (28%). No previously
error-free file regressed (verified via `kotlin-corpus-gate.mjs`'s clean-parse count, not just the
worst-N list). Full suite (`npm test`, 1810 tests) and `npm run typecheck` pass clean; new coverage
added to `kotlin.complexity.test.ts` (file-level annotation args, declaration annotation args,
non-`file` use-site target with args, bare no-arg annotation regression check) since this file had
zero prior annotation coverage.

## `private constructor(...)` mis-scoping fixed (2026-09-16)

Follow-up dogfooding after the annotation-argument fix above found a real regression: okhttp's
`Cookie.kt` (and `ConnectionSpec.kt`) lost `equals`/`toString`/etc. from `find_complex_functions`'s
per-function breakdown, while the file-level aggregate complexity stayed high — a visible
inconsistency (e.g. Cookie.kt: file complexity 83/cognitive 147, but the enumerated `functions`
array summed to a small fraction of that and was missing exactly the functions a human would flag
as hotspots).

**Root cause:** `class Cookie private constructor(...)` — a modifier directly before the
`constructor` keyword — hits a pre-existing, already-documented grammar gap (`PrimaryConstructor`
deliberately had no leading `modifier*`, see `docs/adr-021-kotlin-parsing.md`'s scope-cuts table).
That doc undersold the actual damage, confirmed by diffing tree shape before/after with a minimal
repro:
- **Pre-annotation-fix baseline:** the ambiguity already mis-scoped every subsequent class member —
  `equals`/`matches`/etc. ended up as `FunctionDeclaration` nodes with `parent: Program` (top
  level) instead of nested in the class's `ClassBody`. Wrong owner attribution, but still
  individually discoverable.
- **Post-annotation-fix:** the *same* input resolved the ambiguity differently — it collapsed into
  one bogus top-level `FunctionDeclaration` named `"constructor"` whose `Block` body swallowed the
  entire rest of the class as statement content. Every subsequent method became a
  `LocalFunctionDeclaration` (not `FunctionDeclaration`) buried inside that block —
  `collectFunctionComplexity`'s cursor walk (`src/parser/complexity/kotlin.ts`) only matches
  `FunctionDeclaration`/`SecondaryConstructor`, so those members vanished from both the per-function
  list and call-edge extraction, while `computeComplexity`'s type-agnostic whole-tree walk still
  (correctly) counted their cost in the file-level aggregate. Neither shape produces error nodes, so
  `ERROR_RATIO_THRESHOLD` never caught it — a silent structural mis-parse, always wrong, just wrong
  in a *worse* way after the annotation fix widened how much content the mis-parse swallowed.

**Fix:** `PrimaryConstructor { modifier* (!greedy ckw<"constructor">)? "(" commaSep<ClassParameter>
")" }` — added the missing leading `modifier*`. Built clean on the **first attempt**, no `!greedy`
even needed on the new `modifier*` itself (the existing `!greedy` on `ckw<"constructor">` was
enough) — the original "ambiguous against the next sibling's modifier soup" theory didn't hold once
actually tried, same lesson as the annotation-argument fix above. Verified via tree-shape diff (all
21 real members of okhttp's `Cookie.kt` now correctly nested under `ClassBody`, not scattered across
`Program`/buried in a bogus `Block`), no new choice-count warnings on `ClassDeclaration`/
`PropertyDeclaration` (both fixed earlier today, re-checked since this rule sits right next to
them), full suite (1814 tests) + `npm run typecheck` pass clean, corpus re-scan shows further
improvement (error ratio 0.46% → 0.449%, clean-parse files 96 → 98, no regression). Two new
regression tests added to `kotlin.complexity.test.ts` (`private constructor`, `internal
constructor`) asserting every subsequent member surfaces correctly scoped — this exact regression
had zero prior test coverage. Dogfooding found 39 real okhttp files use this pattern.

**Not fixed, same gap class, not yet attempted:** `private set`/`get`/`set` accessors still don't
accept a leading modifier (`PropertyAccessor` has the identical "no leading `modifier*`" comment,
`docs/adr-021-kotlin-parsing.md`'s scope-cuts table) — worth trying the same fix if it turns out to
matter in practice, but out of scope for this pass.

## How to resume

Phase 2 is done. Remaining work is Phase 0b (grammar coverage growth, as-needed) per the main plan
file (`/Users/karolmachulski/.claude/plans/gleaming-petting-goose.md`) — no specific trigger queued;
add rules when a real construct trips the error-density gate or a corpus file. The known
`InfixExpression` gap (a *with-arguments* constructor call immediately following another statement
with no separator still loses its edge, see Phase 1 above) remains open and untouched by Phase 2.
