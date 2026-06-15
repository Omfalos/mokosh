# ADR-004: Type Graph — Type-Level Dependency Layer

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

The import graph tracks file-to-file dependencies but carries no information about which specific exported symbols are types (interfaces, classes, enums, type aliases) versus values (functions, constants). This makes it impossible to answer questions like:

- "Which files depend on the `FileNode` interface?"
- "What types does `GraphBuilder` use?"
- "If I change this interface, what is the type-level blast radius?"

AI assistants reasoning about refactors or type migrations need a focused, token-efficient answer to these questions without receiving the full graph.

---

## Decision

Build a derived `TypeGraph` from the existing import graph on demand. The type graph is not stored on `FileNode` — it is computed from the already-available `exports` and `imports` data on every node.

---

## Design

### What counts as a type

A symbol is included in the type graph when:
- Its export signature begins with `interface `, `class `, or `enum ` — regardless of the file's category.
- The file's category is `type-only` — in that case every export is treated as a type, even if its signature is absent or ambiguous.

Plain functions and value constants are excluded even if they are exported by a type-heavy file.

### Build algorithm (`buildTypeGraph`)

Two passes over all TypeScript/JavaScript nodes in the graph:

1. **Collect type nodes**: for each TS/JS file, filter exports to those that pass `isTypeExport`, then index them under the key `"<filePath>::<typeName>"`. Each entry is a `TypeNode { name, file, kind, doc? }`.

2. **Build type edges**: for each TS/JS file, walk its import edges. For each named symbol in an import's `symbols` list, check whether `"<toPath>::<symbol>"` exists in the type index. If so, emit a `TypeEdge { fromFile, toType, toFile }`.

Non-TypeScript/JavaScript files produce no type nodes or edges.

### Query API (`queryTypeGraph`)

Takes the pre-built `TypeGraph` and an exact type name. Returns `TypeQueryResult`:
- `type` — the `TypeNode` for the queried name, or `null` if not found.
- `usedByFiles` — files that import this type (one-hop inbound edges).
- `uses` — types that the defining file imports from other files (one-hop outbound type edges).

The query is deliberately one-hop only. Transitive type graphs grow very large and are rarely what the consumer needs.

**MCP tool**: `get_type_graph` — calls `buildTypeGraph` then `queryTypeGraph` for the requested type name.

---

## Options considered

### A. Store type nodes on `FileNode`

Add a `typeExports?: TypeNode[]` field to `FileNode` so type information is always available without a separate build step.

**Rejected**: the type graph is a derived view — all data needed to construct it already exists in `exports` and `imports`. Co-locating it on `FileNode` would duplicate information and inflate the serialised graph for all consumers, not just those that need type queries.

### B. Include function exports with type signatures

Include functions whose parameters or return types reference known types.

**Rejected**: this requires type inference or a full type-checker pass. The current approach uses only the signature prefix strings already captured during parsing — no new AST work needed.

### C. Multi-hop / transitive queries

Return the full transitive closure of dependents and dependencies for a queried type.

**Rejected for now**: useful but expensive to communicate (potentially the whole graph). Callers that need transitive analysis can call `get_affected` on the file level, which is already implemented and covers the common case.

---

## Consequences

**Positive**
- Token-efficient: a single `get_type_graph` call answers "who uses type X?" without sending the full graph.
- Zero new parsing: builds entirely from data already on `FileNode` — no extra AST pass.
- `kind` field (`interface` / `class` / `enum` / `type`) lets consumers distinguish structural types from aliases without re-parsing.

**Negative**
- `type-only` file heuristic is a category-level approximation: all exports in such files are treated as types, even non-type re-exports (rare in practice but possible).
- Query returns the first match when multiple files export the same name. Callers that need disambiguation must use the `"<file>::<typeName>"` key directly.
- One-hop only: consumers that need transitive type impact must chain multiple queries or fall back to the file-level `get_affected`.