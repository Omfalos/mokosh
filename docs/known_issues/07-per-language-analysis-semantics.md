# Issue 7 — Analyses treat every language like JS/TS; each needs its own semantics

Status: proposed, not started. Found dogfooding v0.5.0 (2026-09-03).

## Symptom

`find_duplicates` (and other analyses) run one generic algorithm for every language. That
misses language-specific duplication that matters and reports language-agnostic shapes that
don't:

- **CSS/SCSS/Less**: duplicate *custom properties / variables* with the same value
  (`--spacing-md: 8px` defined in three files; `$brand: #3b82f6` and `--brand: #3b82f6`
  holding the same value) are never reported. `findStyleBlockDuplicates`
  (`src/graph/duplication/style-blocks.ts`) only compares rule *bodies*, not `:root` /
  `$`-variable declarations or design-token drift.
- **TypeScript**: two `interface` / `type` declarations that are structurally 1:1 identical
  (same members, same types — not counting primitive/base types) are a real refactor target
  and are invisible today. The token pipeline can match them only if the textual token run is
  long enough and identical, and it can't tell "identical type contract" from "coincidentally
  similar token shape".
- **JVM (Java/Kotlin/Scala)**: duplication that matters is at the *declaration* level —
  identical DTO/record shapes, identical enum sets, copy-pasted `@Entity` field blocks,
  duplicated Bean/`@Configuration` wiring — not arbitrary token windows. Idiomatic
  boilerplate (getters/setters, `equals`/`hashCode`) should be excluded, not flagged.
- **Go**: identical `struct` definitions, repeated `if err != nil { return err }` (idiomatic,
  should be excluded).
- **Python**: identical `@dataclass` / `TypedDict` / Pydantic model shapes.

## Root cause

The duplication pipeline has exactly two strategies (`src/graph/duplication/index.ts`):
structural for `css/scss/less` rule bodies, generic token-shingle for everything else. There
is no per-language "definition extractor" and no notion of comparing *declarations* (types,
structs, variables, enums) as opposed to *token runs*. `tokenize()`
(`src/graph/duplication/tokenizer.ts`) is explicitly "one generic tokenizer rather than a
per-language lexer".

More broadly, several analyses assume the TS/JS model:

- `complexity` / `callEdges` exist only for TS/JS, Go, Python, Java (per `languageCoverage`
  in `analyze` output) — Kotlin/Scala/Groovy/Coffee/LiveScript/Lua have none.
- `category` classification (`src/parser/classify.ts` + per-language `classifyJvm` etc.) is
  uneven.
- `exports` semantics differ (JVM "exports" = top-level types only; no field/method-level).

## Fix plan

### 7a — a per-language "definition duplicate" extractor interface

Add `DefinitionExtractor` alongside the parser registry: given a parsed AST/tree, emit
normalized *definitions* with a canonical structural hash:

```ts
interface DefinitionDuplicate {
  kind: "type" | "interface" | "struct" | "enum" | "cssVar" | "record" | "dataclass";
  name: string;
  file: string; line: number;
  structuralHash: string;   // canonical, order-normalized, base-type-aware
  memberCount: number;
}
```

`findDuplicates` gains a third strategy: group definitions by `structuralHash`, report groups
with ≥2 members as duplicate *definitions* (distinct from duplicate *blocks* in the result
shape — a `kind: "definition"` group).

### 7b — per-language implementations

- **CSS/SCSS/Less** (`src/parser/style/*` already build PostCSS ASTs): extract every custom
  property (`--x`), SCSS/Less variable (`$x` / `@x`), and their resolved values. Report:
  (1) the same variable name declared with different values across files (token drift),
  (2) different names holding the same value (consolidation candidate). New
  `src/graph/duplication/style-vars.ts`.
- **TypeScript** (`src/parser/lang/typescript.ts` uses the TS compiler API): canonicalize
  `interface` / `type` literal members — sort by name, normalize optionality, resolve type
  references, **ignore** declarations that reduce to a single primitive/`unknown`/`any`.
  Hash the canonical form. Reuses `src/graph/type-graph.ts` machinery.
- **JVM**: from the Lezer trees (`java.ts`) and hand-rolled scanners (`kotlin.ts`,
  `scala.ts`), extract record/`data class`/POJO field lists and enum constant sets; canonical
  hash on `(fieldName, fieldType)` sorted. Exclude pure-accessor classes.
- **Go**: `struct` field lists from the Go parser; canonical hash.
- **Python**: `@dataclass` / `TypedDict` / class-with-annotations field lists.

### 7c — per-language idiom exclusion list

A registry of "this is idiomatic, not duplication" matchers per language — Java accessors /
`equals`/`hashCode`, Go `if err != nil`, TS re-export barrels, `__init__` boilerplate. Used
by both the block and definition strategies. Ties into
[issue 5](05-find-duplicates-and-cycles-noise.md)'s `signals`.

### 7d — config surface

`MokoshConfig.languages.<lang>` block for per-language toggles: `duplication.definitions`,
`duplication.excludeIdioms`, `complexity`, etc. One place to see and tune per-language
behavior.

## Expected outcome

- `find_duplicates` on a CSS codebase reports design-token drift and consolidation
  candidates.
- On a TS codebase, reports 1:1-identical `interface`/`type` pairs as definition duplicates.
- On JVM/Go/Python, reports identical data-shape declarations; stops flagging idiomatic
  boilerplate.

## Test plan

- Unit per extractor (`src/graph/duplication/style-vars.test.ts`, `.../type-defs.test.ts`,
  `.../jvm-defs.test.ts`, …): fixtures with known identical/near-identical/base-type-only
  declarations → correct grouping; primitive-only type alias not reported.
- Unit: CSS `--brand` = `$brand` value match reported; `--brand` with two different values
  reported as drift.
- Unit: Java class with only getters/setters never reported (7c).
- Integration: `find_duplicates` result contains both `kind: "block"` and
  `kind: "definition"` groups; [issue 6](06-duplicates-query-language.md) `filter` can select
  `kind:definition`.
- Regression: existing block-duplication behavior unchanged when definition strategy finds
  nothing.

## Files touched

new `src/graph/duplication/definitions.ts` (strategy + registry),
`src/graph/duplication/style-vars.ts`, `src/graph/duplication/type-defs.ts`,
`src/graph/duplication/jvm-defs.ts`, `src/graph/duplication/index.ts`,
`src/graph/duplication/suffix-duplicates.ts` (result shape), `src/parser/registry.ts`,
`src/graph/type-graph.ts`, `src/config.ts`, `src/mcp/tools.ts`, `docs/mcp.md`,
new `docs/adr-019-per-language-duplication.md`.

## Dependencies

Shares the `signals` / idiom-exclusion surface with
[issue 5](05-find-duplicates-and-cycles-noise.md); result-shape change coordinates with
[issue 6](06-duplicates-query-language.md). Feeds
[issue 8](08-cross-language-reliability.md)'s parity matrix.
