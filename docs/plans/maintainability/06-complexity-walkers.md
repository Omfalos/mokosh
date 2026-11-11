# 06 — Unify per-language complexity walkers

## Problem *(verified)*
`parser/complexity/go.ts` and `java.ts` are 64-67% duplicated (five matching blocks, up to 91
lines); `kotlin.ts` (614 lines) shares blocks with both; `python.ts` shares with `lang/python.ts`.
Similar pairs in parsers: `coffee.ts`/`ls.ts` (33-37%), `groovy.ts`/`scala.ts` (47-70%).

## Pattern
**Template Method with per-language data tables.** A shared walker computes cyclomatic and
cognitive complexity and call edges; each language supplies:

```ts
{ functionNodes, branchNodes, nestingNodes, logicalOperators, callNodes, nameOf(node) }
```

Languages with real exceptions override single hooks. `lezer-utils.ts` (85 lines) is the natural
home for the shared walker.

## Steps
1. Pick the pair with the largest overlap (`go`/`java`) and write the shared walker so existing
   `*.complexity.test.ts` and `*.call-edges.test.ts` pass unchanged.
2. Move `kotlin` onto it, then `python`.
3. Apply the same idea to `coffee`/`ls` and `groovy`/`scala` parsers (separate PR).

## Risks
Go and Java use different grammars (tree-sitter-style node names vs Lezer); the table must abstract
node-type names, not assume a shared parser. Cognitive-complexity numbers must not drift — compare
`find_complex_functions` output before and after.

## Done when
The duplicate finder no longer reports the `complexity/*` clusters, and adding a language's
complexity support is a table plus tests.
