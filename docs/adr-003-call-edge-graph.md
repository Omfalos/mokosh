# ADR-003: Call-Edge Graph — Function-Level Dependency Layer

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

Mokosh's import graph operates at file granularity: an edge means "file A imports file B." This is enough for blast-radius analysis (`get_affected`, `get_dependents`) but too coarse for questions like:

- "Which exported functions actually call `parseFile` at runtime?"
- "What does `build()` call, and in which files?"
- "Is this import edge a real runtime dependency or just a type import?"

The gap matters for:
- **AI assistants** using the MCP server, which need function-level context to reason about refactoring a single function without over-approximating blast radius.
- **Callers tool** (`--callers`): identifying files with live call edges to a target is more precise than import reachability.
- **Future impact scoring**: weighting edges by actual invocation frequency vs. mere import presence.

The question was how to layer function-level call information onto the existing graph without changing its core model or making the build pipeline async.

---

## Decision

Add a `callEdges?: CallEdge[]` field to `FileNode`. A `CallEdge` is a `{ from, to, toFile }` triple: the name of the calling function, the name of the callee function, and the project-relative path of the file that defines the callee.

Call edges are extracted during TypeScript/JavaScript parsing and resolved during graph build. They are stored on the node alongside import edges, not in a separate data structure.

---

## Design

### Extraction (TypeScript parser)

After import and export collection, `collectRawCallEdges` runs a second AST pass:

1. **Build an import-symbol map**: walk every `ImportDeclaration` in the file and map each imported local name (`parseFile`, `build`, etc.) to its module specifier (`"../parser"`, `"./builder"`, etc.).
2. **Walk top-level exported functions**: for each `export function foo` or `export const foo = () =>` declaration, walk its body with `walkCallExpressions`.
3. **Walk class method bodies**: for each named class declaration (exported or not), walk every method and constructor body. Edges from class members use `ClassName.methodName` (or `ClassName.constructor`) as the `from` field.
4. **Record call expressions**: when a `CallExpression` whose callee is a known imported symbol is found, push a `RawCallEdge { from: fnName, to: callee, toSpecifier: specifier }`. Deduplication prevents recording the same `(from, to, specifier)` triple twice within one file.

`collectRawCallEdges` is skipped for `category === "test"` files — test call edges are noise for the graph queries this feature targets.

**Scope constraints (deliberate)**:
- Tracked callers (`from`): top-level exported functions and methods/constructors of any named class. Unexported private helpers (non-class functions) are out of scope.
- Only directly imported symbols are tracked as callees (`to`). Calls through re-exported objects, chained member access, or dynamic dispatch are not captured.
- Only TypeScript/JavaScript files produce call edges. All other parsers return no `rawCallEdges`.

The output is a `RawCallEdge[]` on `ParseResult` — specifiers are still unresolved strings at this point.

### Resolution (`GraphBuilder.resolveCallEdges`)

After a file is parsed, `resolveCallEdges` converts each `RawCallEdge` to a `CallEdge`:

1. Call the resolver with the raw specifier — the same `DefaultResolver` used for import edges.
2. Drop the edge if the result is external or unresolvable.
3. Convert the resolved absolute path to a project-relative `toFile`.

External call edges (calls into `node_modules`) are dropped because they are irrelevant to internal blast-radius analysis and would bloat the stored graph.

### Storage

`callEdges` is omitted from the `FileNode` when the array is empty. This keeps serialised graphs lean for files with no call edges.

### Query API

**`queryCallGraph(graph, functionName)`**:
- Scans every node's `callEdges` for edges where `to === functionName` → callers.
- Looks up the defining node (via `exports`) and reads its `callEdges` for edges where `from === functionName` → callees.
- Returns `FunctionCallInfo { functionName, definedIn, callers, callees }`.

**MCP tools**:
- `get_call_graph` — looks up callers and callees for a named function. Never returns the full unfiltered graph; always requires a function name.
- `get_callers` — file-level traversal over `callEdges` (more precise than `get_affected` for live runtime dependencies).

---

## Options considered

### A. Separate call graph structure

Keep `callEdges` out of `FileNode` and store them in a parallel `Map<string, CallEdge[]>` or a dedicated `CallGraph` object alongside the import `Graph`.

**Rejected**: adds a second cache key and a second serialisation path. Since call edges are per-file and consumed together with the import graph, co-location in `FileNode` is simpler. The field is optional, so files without call edges pay no overhead.

### B. Full call graph (all call sites, including private functions)

Track every call expression in the file, not just those from top-level exported functions.

**Rejected**: the intended consumer is AI-driven impact analysis, which asks "if I change this exported function, who is affected?" Private helper call edges are internal to the file and not useful for cross-file analysis. Expanding scope would also produce much larger `callEdges` arrays per node.

### C. Runtime-instrumented call graph

Collect call edges from production traces or test coverage rather than static analysis.

**Rejected**: out of scope for a static analysis tool. Dynamic call graphs require instrumentation infrastructure and are environment-specific. Static extraction is available at build time with no runtime dependency.

### D. Full inter-procedural / method-level tracking

Track calls through chained member access (`obj.method()`), re-exported wrappers, and type-resolved dispatch.

**Rejected for now**: precise inter-procedural analysis requires a type-checked AST (full `Program` + type checker), not just a source-file AST. The TypeScript compiler API supports this but constructing a full `Program` per file is significantly more expensive than `createSourceFile`. Class method bodies are walked on the source-file AST (no type checker needed), but calls through wrapper objects and dynamic dispatch remain out of scope.

---

## Consequences

**Positive**
- AI assistants can answer "who calls X?" and "what does X call?" with a single MCP call, with no need to scan source files.
- `get_callers` is more precise than `get_affected`: it only returns files with actual runtime call edges, not files that merely import a target.
- Call edges reuse the existing `DefaultResolver` and the `FileNode` serialisation path — no new infrastructure.
- The `RawCallEdge → CallEdge` two-step mirrors the existing `rawSpecifier → ImportEdge` pipeline, keeping the architecture consistent.

**Negative**
- Static call analysis misses dynamic dispatch, conditionally imported modules, and calls through wrapper objects. Callers and callees lists should be treated as lower bounds, not exhaustive.
- Only exported top-level functions and class methods are tracked as callers. A private helper that calls an imported function is invisible unless it is invoked by a tracked caller (that caller appears in the edge, not the private helper).
- Call edge collection adds a second AST pass per TypeScript/JavaScript file. The pass is fast in practice (import-symbol map + body walk), but it is not free and cannot be skipped via a build option today.
- Test files are excluded from call edge collection by design. This means `propose_affected_tests` and test-coverage reasoning still rely on the import graph, not call edges.