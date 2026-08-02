# ADR-011: Extending Complexity and Call Edges to Go and Python

**Date:** 2026-08-02
**Status:** Accepted

---

## Context

[ADR-003](./adr-003-call-edge-graph.md) added function-level call edges to the graph, and `src/parser/complexity.ts` added McCabe cyclomatic and cognitive complexity scoring — both deliberately scoped to TypeScript/JavaScript only, since the TypeScript compiler API was the only AST available at the time.

Go and Python parsers (via `@lezer/go` and `@lezer/python`) already existed for imports, exports, and tags, but produced no `complexity`, `cognitiveComplexity`, `functions`, or `rawCallEdges` — every consumer of those fields (`find_complex_functions`, `get_call_graph`, `get_callers`, `find_symbol`'s `"call"` precision tier) silently returned nothing for Go and Python files. This asymmetry surfaced while auditing language parity after Lua and CoffeeScript gained export extraction: Go and Python already had exports and tags, but lagged behind TS/JS specifically on complexity and call edges.

---

## Decision

Extend both features to Go and Python, reusing the existing `RawCallEdge → CallEdge` resolution pipeline in `GraphBuilder` unchanged — only the parser-side extraction is new. `CALL_EDGE_TYPES` in `src/graph/language-support.ts` (the single source of truth consumed by `find_symbol`, `getLanguageCoverage`, and their docs) now includes `go` and `python` alongside `typescript`/`javascript`.

A related latent bug was fixed in passing: Go's export scan (`src/parser/lang/go.ts`) matched `FunctionDecl`/`TypeDecl`/`VarDecl`/`ConstDecl` but never `MethodDecl` — meaning every exported receiver method (`func (r *Receiver) Method()`, the most common way Go attaches behavior to a type) was invisible to `exports`. Fixed by also matching `MethodDecl`'s `FieldName` child.

---

## Design

### Complexity (`src/parser/complexity/go.ts`, `src/parser/complexity/python.ts`)

Both mirror `src/parser/complexity.ts`'s algorithm — McCabe base 1, `+1` per decision point; cognitive complexity adds `1 + nesting depth` for structural nodes and a flat `+1` for `else if`/`else`/logical operators — but walk `@lezer/common` `SyntaxNode` trees (via `firstChild`/`nextSibling`, since Lezer nodes don't expose a single `getChildren()`) instead of the TS compiler API, and compute line numbers by counting newlines (Lezer trees carry no line/column info, unlike `ts.SourceFile`).

**Go** follows the TS/JS tree shape closely: `if`/`else if` is a nested `IfStatement` under the `else` keyword, exactly like TS's `elseStatement`. Go has no `try`/`catch` or ternary, so those decision points have no Go equivalent; `&&`/`||` appear as a `LogicOp` leaf node whose text is checked directly. Go's `Case` node type covers both `case` and `default` labels — only `case` is counted, matching TS's `CaseClause`/`DefaultClause` split. `MethodDecl` complexity entries are qualified `ReceiverType.MethodName`, reading the receiver's type off its (possibly pointer-wrapped) first `Parameters` child.

**Python's grammar is structurally different** and required different branch-walking logic, not just a node-name swap: `if`/`elif`/`else` compiles to one **flat** `IfStatement` node with `if`/`elif`/`else`/condition/`Body` as direct siblings, not nested nodes — same for `try`/`except`/`else`/`finally` in `TryStatement`. The walker iterates these siblings in fixed-size groups (`if`/`elif` + condition + `Body`, `except` + optional exception-type expression + `Body`) rather than recursing into a nested `elseStatement`-like child. Each `except` clause scores like TS's `CatchClause` (`+1 + depth`, but its own body does *not* get an extra nesting level — matching, deliberately, an existing TS quirk in `computeCognitiveComplexity` where `catch` bumps the score but walks its children at the *same* depth). `and`/`or` appear as literal keyword leaf nodes (unlike Go's wrapped `LogicOp`), matched directly by node name. `ConditionalExpression` is Python's ternary. Class methods are found by scanning a `ClassDefinition`'s `Body` for direct `FunctionDefinition` children and qualifying them `ClassName.methodName`; a function nested inside a method keeps its own bare name, unqualified — the same rule TS applies to a plain nested function declaration inside a class method.

### Call edges

**Go** (`collectRawCallEdges` in `go.ts`): Go's import model has no per-symbol equivalent to `import { foo } from "bar"` — every cross-package call is qualified (`pkg.Func()`). So the "imported symbol map" here maps *package identifiers* (an explicit alias, or the conventional last path segment) to import specifiers, and the walk looks for `CallExpr` whose callee is a `SelectorExpr` (`pkg.Func`) where `pkg` is a known package identifier. Unqualified same-file calls aren't cross-file dependencies and are skipped, same as TS ignoring calls to non-imported local names. Tracked callers: top-level exported (`FunctionDecl`, uppercase name, mirroring TS's exported-function rule) and **any** `MethodDecl` regardless of export — a receiver method always names its enclosing type, mirroring TS's "any named class" rule for methods.

**Python** (`collectRawCallEdges` in `python.ts`): deliberately narrower, to stay faithful to ADR-003's stated exclusion of "chained member access." Only `from <module> import <name> [as alias]` bindings are tracked as callable symbols (aliases resolved), and only bare `CallExpression`s whose callee is a plain `VariableName` are recorded. `import module` followed by `module.func()` is **not** tracked — that's a `MemberExpression` callee, structurally the same "chained member access" case TS already excludes for `obj.method()`. This means Go and Python use different qualification philosophies for the same underlying problem (package-qualified access is Go's *only* cross-package call form and had to be supported for the feature to do anything at all; Python has a direct unqualified form that's the closer TS analogue, so that's what's tracked, and the qualified form is left out on purpose rather than by oversight).

Both skip `category === "test"` files, matching ADR-003.

### `find_symbol` precision consequence

`src/graph/symbol.ts`'s `findSymbol` previously had a third precision tier, `"import-symbol"`, that fired for languages in `IMPORT_SYMBOL_TYPES` (`typescript`, `javascript`, `python`) but not `CALL_EDGE_TYPES`. Since `IMPORT_SYMBOL_TYPES` is now fully contained in `CALL_EDGE_TYPES`, Python matches upgrade from `"import-symbol"` precision to `"call"` precision, and Go matches upgrade from `"file-level"` to `"call"`. That left the `"import-symbol"` branch unreachable by any real `FileType` — it was deleted outright (along with the `"import-symbol"` value from the `SymbolPrecision` type) rather than kept around for a hypothetical future language; `IMPORT_SYMBOL_TYPES` itself stays, since `getLanguageCoverage()` still uses it independently to report whether `ImportEdge.symbols` is populated, a real capability distinct from call-edge tracking.

---

## Consequences

**Positive**
- `find_complex_functions`, `get_call_graph`, `get_callers`, and `find_symbol`'s `"call"` tier now work for Go and Python, not just TS/JS.
- Go's `MethodDecl` export gap is fixed, improving `exports`, `get_api_surface`, and export-usage enrichment accuracy for any Go codebase with receiver methods (i.e., nearly all of them).
- The `RawCallEdge → CallEdge` resolution path in `GraphBuilder` required zero changes — validating ADR-003's original design choice to keep that boundary language-agnostic.

**Negative**
- Python call-edge coverage is narrower than Go's or TS/JS's: `import pkg; pkg.func()` (arguably the more common form for calling into a Python package rather than a single symbol) is not tracked, only `from pkg import func; func()`. Callers/callees for Python should be read as a lower bound, more so than for TS/JS.
- Go's package-identifier resolution assumes the conventional last-path-segment package name when no alias is given; a package whose declared name doesn't match its import path's last segment (rare, but legal Go) will silently fail to resolve.
- Two more bespoke AST walkers to maintain (`complexity/go.ts`, `complexity/python.ts`, plus the call-edge functions inline in `go.ts`/`python.ts`), each tied to its own Lezer grammar's node names, which will drift silently if either grammar version changes shape.