# ADR-018: Per-Language Definition Duplicates (Phase 1 — CSS Vars + TS Types; Phase 1b — Object Literals; Phase 1c — JSX Elements)

**Date:** 2026-09-04 (phase 1); 2026-09-05 (phases 1b, 1c)
**Status:** Implemented (phase 1 of [issue 7](./known_issues/07-per-language-analysis-semantics.md)
— CSS/SCSS/Less variables, TypeScript `interface`/`type` shapes, (phase 1b) content-identical
`const` object literals, and (phase 1c) content-identical JSX/TSX elements, across TS and JS for
1b/1c). JVM, Go, Python, the idiom-exclusion registry (7c), and the `MokoshConfig.languages`
surface (7d) are deferred.

---

## Context

Every strategy `find_duplicates` had before this ADR — the token-shingle pipeline
([ADR-012](./adr-012-duplicate-detection.md)) and the CSS/Less/SCSS structural rule-body
comparator ([ADR-013](./adr-013-duplicate-detection-noise-reduction.md)) — matches *spans of
code*: a window of tokens, or a rule's declaration body. Neither can express "these two
declarations are the same shape," which is a different, and in several languages more actionable,
kind of duplication:

- Two `interface`/`type` declarations with identical members but different names, different
  member order, or different formatting are a real "these should be one declaration" refactor
  target — but too structurally reordered for token-shingling to catch reliably, and (for a
  short declaration) too small to clear `windowSize` even when it would.
- A design-token value (`--spacing-md`, `$brand`) repeated under a different name across files is
  a consolidation candidate; the same name holding *different* values across files is usually an
  accidental inconsistency. Both are invisible to rule-body comparison, which only ever compares
  whole declaration lists, not individual variable values.

[Issue 7](./known_issues/07-per-language-analysis-semantics.md)'s full scope covers five
languages plus an idiom-exclusion registry and a config surface. This phase implements the two
best-specified pieces — CSS/SCSS/Less variables and TypeScript object-shaped types — and leaves
the rest for a follow-up, the same way [ADR-013's Phase 5](./adr-013-duplicate-detection-noise-reduction.md)
shipped a subset of issue 5 and documented what didn't make it.

## Decision

**Reuse the existing `DuplicateGroup` shape rather than inventing a parallel result type.** A new
`kind: "block" | "definition"` field (absent/`"block"` for every group predating this ADR, for
back-compat) distinguishes the two families of match; a new `defKind: "cssVar" | "interface" |
"type"` names what a `"definition"` group matched on. This keeps `find_duplicates` a single
`groups[]` list — issue 6's future query layer filters on `kind`/`defKind` the same way it will
filter on `family`/`signals`, rather than needing a second endpoint or a union return type.
`lines`/`tokens` are repurposed rather than made optional-with-new-fields: `lines` is the
declaration's own line span, `tokens` is its member/field count — keeps the existing
largest-first sort meaningful across both kinds without new required fields.

**Two independent extractors, not a shared "DefinitionExtractor" registry — yet.** The original
issue write-up (7a) proposed a generic `DefinitionExtractor` interface up front, designed for five
languages. With only two implementations landing in this phase, building that abstraction now
would be speculative — `style-vars.ts` and `type-defs.ts` are self-contained modules with the same
external shape (`(files) => DuplicateGroup[]`) that `index.ts` calls directly, mirroring how
`style-blocks.ts` is already wired in. A shared registry is worth introducing once a third
language extractor lands and the actual common surface between them is known, not before.

**CSS/SCSS/Less variables report two distinct findings from one extraction pass** —
`style-vars.ts` buckets the same `(name, value)` records two ways: by value (consolidation
candidate, name-agnostic) and by name where values disagree (`signals: ["value-drift"]`). Reusing
`style-blocks.ts`'s dialect-dispatch parser (`parseStyleAst`, exported for this) means both
modules see identical PostCSS ASTs per file; walking at any nesting depth (via PostCSS's built-in
recursive `walkDecls`/`walkAtRules`, not the root-level-only walk `scss.ts`/`css.ts`'s *export*
extraction does) means a duplicated token inside a nested rule or `@media` block is still found —
duplication detection has no reason to share the narrower "public surface" scope export extraction
does.

**TypeScript type-def extraction re-implements its own `ts.createSourceFile`/printer pair** rather
than importing `src/parser/lang/typescript.ts`'s: that module's printer is scoped to its own
single-file `analyzeNode` traversal and doesn't expose member-level AST access (its
`extractSignature` only ever prints a whole interface/type node's outer signature, e.g.
`"interface FileNode"`, never its members) — `type-defs.ts` needs the member list itself to
canonicalize. Only object-shaped declarations are compared (`ts.isTypeLiteralNode` aliases;
interfaces are always object-shaped) — unions, primitives, `unknown`/`any`, and mapped/conditional
types are skipped, matching the issue's "ignore declarations that reduce to a single primitive"
requirement. Heritage clauses (`extends`) aren't resolved — only a declaration's own members are
compared — a deliberate scope limit, not an oversight: resolving inherited members needs
cross-file type resolution this module doesn't otherwise need.

**No new CLI flags, MCP tool parameters, or `MokoshConfig` surface.** Definition groups are always
computed and flow through the existing `groups`/`limit`/`ignoreDirs`/`includeGenerated` plumbing
untouched — `7d`'s per-language config surface is exactly the kind of thing worth designing once
more than two extractors exist, not speculatively now.

## Consequences

- `find_duplicates` callers filtering on `family: "style" | "code"` are unaffected — `family` is
  still set on every group, definition groups included (`"style"` for `cssVar`, `"code"` for
  `interface`/`type`).
- A cache-hit TypeScript file (`tokenCache` already has fresh tokens for it) still needs a fresh
  read for type-def extraction, since type-def results aren't cached the way tokens are — an
  accepted extra read on the minority path (a repeated same-session call against an unchanged
  file), not a correctness issue. Worth folding into `CachedFileTokens` if this turns out to
  matter on a real large repo.
- Deferred to a follow-up issue: JVM (`record`/`data class`/POJO field lists, enum sets),
  Go (`struct` fields), Python (`@dataclass`/`TypedDict`), the idiom-exclusion registry (7c —
  Java accessors, Go `if err != nil`, TS re-export barrels), and the `MokoshConfig.languages`
  config surface (7d).

## Addendum (2026-09-05): Phase 1b — `const` object literals (TS + JS)

**Status:** Implemented. Direct response to a dogfooding report's "const-object-literal shape
matching" false-positive class in the token-shingle path — `maxPunctuationRatio` gates out blocks
that are *mostly* punctuation, but two unrelated object literals with the same key count and
nesting (not mostly punctuation, just coincidentally same-shaped) still clear that gate.

**Deliberately content-based, not shape-based — the opposite design choice from the TS
`interface`/`type` extractor in this same ADR.** An `interface`/`type` member is a type
position: matching two declarations by member name+type regardless of how instances get
populated is exactly the "these should be one declaration" signal issue 7 targets. A `const`
object literal's members are *values*: two unrelated config objects sharing key names but
different values (`{ host: 'x', port: 80 }` vs `{ host: 'y', port: 443 }`) are not obviously a
duplication candidate the way two identically-shaped types are — many small, legitimately-distinct
option bags share common key names. `src/graph/duplication/object-literals.ts` therefore
canonicalizes `key:printedValue` pairs (via the same `ts.createPrinter` approach `type-defs.ts`
uses for member types), not just key names, so a match requires the same keys *and* the same
values, order-independent. This makes it closer in spirit to `style-blocks.ts`'s content-based CSS
rule-body comparator than to this ADR's own type-shape comparator.

Scope limits, deliberate: only `const` declarations (a reassignable `let`/`var`'s initial shape is
a weaker signal); `as const`/`satisfies`/parenthesized wrappers are unwrapped first; a spread or
computed key disqualifies the whole literal rather than partially matching around it; default
`minMembers: 3` (higher than `type-defs.ts`'s 2) since small 1-2-key option bags are extremely
common and too weak a signal on their own.

**Runs on JavaScript files too, not just TypeScript** — the one place this phase's scope is
*wider* than phase 1's TS-only interface/type extractor, since object literals (unlike
`interface`/`type` syntax) are equally common in plain JS. `src/graph/duplication/index.ts`'s
shared TS/JS source-collection array (previously fed only from `node.type === "typescript"`,
feeding only `findTypeDefDuplicates`) now also collects `node.type === "javascript"` files; running
`findTypeDefDuplicates` over JS files this way is harmless (no `interface`/`type` syntax to find)
rather than adding a second, filtered collection pass.

## Addendum (2026-09-05): Phase 1c — JSX/TSX elements (TS + JS)

**Status:** Implemented. Direct response to the "structurally-templated-by-design files" false
positive class (icon components specifically) flagged in the same dogfooding pass that motivated
1b. `maxPunctuationRatio` doesn't help here — the failure mode isn't punctuation density, it's that
`ignoreLiterals: true` (the default) collapses the one piece of content that actually distinguishes
two icons — an SVG `d` path-data string — to a `STR` placeholder before the token-shingle matcher
ever compares anything, so two unrelated icons sharing identical wrapper markup can token-match.

**Content-based, same family as phase 1b, not phase 1's shape-based type matching** — for the same
reason: two icons sharing wrapper structure but different path data are not a duplication
candidate, only two icons with the *same* path data are. `src/graph/duplication/jsx-elements.ts`
canonicalizes tag name, attribute values as printed (not placeholder-normalized), and in-order
children, recursively.

**Scans every nesting depth, not just whole-component-return shapes** — a deliberate scope choice
wider than 1b/phase-1 (which only look at top-level declarations): a genuinely duplicated element
embedded inside an otherwise-different component should still be found. The cost of that choice:
scanning every depth means a matched outer element and its matched inner elements independently
clear the comparison and would, unfiltered, report the same underlying duplication as several
groups — the exact "family of LCP-tree nodes" redundancy `applyDominanceFilter`
(`suffix-duplicates.ts`, see this ADR's [ADR-015 companion](./adr-015-suffix-array-duplicate-detection.md))
was built to fix for the token-shingle path. `dropContainedGroups` in the new module applies the
same containment-based consolidation independently, over AST line spans instead of token indices —
same accepted lossy trade-off (can rarely under-report a pairing subsumed by an unrelated larger
match), same reasoning, deliberately not re-derived from scratch.

**Not consolidated with phase 1/1b's parsing.** This is now a *third* independent
`ts.createSourceFile` parse of every TS/JS file `find_duplicates` scans — `type-defs.ts` and
`object-literals.ts` already didn't share a parse with each other (ADR-018's own phase-1 text
already flagged this as "worth folding into `CachedFileTokens`... if this turns out to matter").
Adding a third pass compounds that, but wasn't addressed here deliberately: consolidating all
three into one shared parse means changing two already-shipped, tested modules' internals for a
performance concern nobody has profiled yet on a real repo. Left as a flagged, not-yet-measured
cost rather than a preemptive refactor.
