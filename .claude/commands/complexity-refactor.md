# complexity-refactor — Complexity-Driven SOLID Refactor

Find the most complex functions in the codebase via the mokosh MCP server, then propose SOLID-principle refactors for each one.

## Process

1. **Ensure the graph is built.** Call `analyze({ root: "<abs-project-root>", entryPoints: [...] })` if not already called this session.

2. **Find complex functions.** Call:
   ```
   find_complex_functions({ root, metric: "cognitiveComplexity", threshold: 10, limit: 20 })
   ```
   Also run it with `metric: "complexity"` (cyclomatic) to catch functions that are structurally branchy but not flagged by cognitive complexity, or vice versa. Merge the two result lists, de-duplicating by file+function.

3. **Rank by severity.** Sort the merged list worst-first (highest score). If the list is large, work through it in batches rather than trying to refactor everything in one pass — confirm scope with the user first if there are more than ~5 candidates.

4. **For each flagged function, read the containing file** and run the SOLID checklist below against it — not just the flagged function in isolation, but its class/module context (complexity often correlates with SRP violations).

5. **Propose a refactor** per function using the output format below. Do not apply changes until the user confirms which ones to act on.

## SOLID checklist (apply per flagged function/file)

### S — Single Responsibility
- Function mixes I/O, data transformation, and business logic
- Function name uses "and"/"or" or does 2+ unrelated things
- High complexity often means the function should split into smaller named steps, each with one reason to change

### O — Open/Closed
- `if`/`switch` on a type discriminant that must grow whenever a new case is added
- `instanceof` chains used to dispatch behavior
- Deeply nested conditionals that could become a strategy/lookup table instead

### L — Liskov Substitution
- Override throws `"not implemented"` or narrows/widens the base signature's contract

### I — Interface Segregation
- Function takes a wide options object but only touches a few fields
- Could take a narrower `Pick<T, K>` or a small callback instead

### D — Dependency Inversion
- `new ConcreteService()` constructed inline instead of injected
- Direct calls to modules with side effects, no seam to swap implementations

## Output format

```
[complexity: 24 cognitive] src/graph/builder.ts:build()
  [S] Mixes FS traversal, parsing, and resolution in one function
  Fix: extract `walkEntryPoints()`, `parseAndResolve()` as separate steps

[complexity: 16 cyclomatic] src/parser/lang/typescript.ts:classify()
  [O] Long if/else chain dispatching on node.kind
  Fix: replace with a Map<SyntaxKind, Handler> lookup
```

End with:
> Refactor any of these now? (yes / specify which / skip)

## Rules

- Never refactor a function without first showing the proposed change and getting confirmation — complexity refactors change control flow and are easy to get subtly wrong.
- Skip functions where high complexity is inherent to the domain (e.g. a big but flat `switch` over a stable, closed enum) — only flag genuine SOLID violations, not every complex function.
- After applying any refactor, run `npm run typecheck` and `npm test` to confirm no regressions.