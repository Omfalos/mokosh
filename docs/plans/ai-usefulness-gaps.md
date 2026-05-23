# Plan: AI Usefulness Gaps

Analysis of mokosh's current usefulness for AI agents (Claude Code / MCP clients), with gaps ranked by priority.

## What works well

- **MCP-first architecture** — AI agents call tools natively; no CLI round-trips needed.
- **`slim: true` mode** — compact node responses keep token cost low.
- **Call graph with symbol precision** — `get_callers({ withEdgeDetail: true })` gives function-to-function edges, rare among dependency tools.
- **`propose_affected_tests`** — output is test paths ready to pipe into vitest; no further AI reasoning required.
- **Export usage ratios** (`avgExportUsage`, `maxExportUsage`) + `testedBy` reverse-index — surface dead exports and test coverage at node level.
- **Rich query DSL** — 14+ filter dimensions including `minCoverage`, `minExportUsage`, `sort:commitCount90d`.

---

## Gaps

### P2 — Medium

**No symbol-level reverse lookup.**
`get_callers` requires a file path as input. The AI first has to know which file defines a symbol. A `find_symbol({ root, name: string })` tool that returns the defining file + callers in one call would collapse a two-step flow into one.

**`get_dependencies`, `get_dependents`, `get_affected` return bare paths only.**
The AI almost always needs `category` and `exports` alongside paths to decide what to do next. A follow-up `query` call is currently required.

Add `withMeta?: boolean` option (default `false`) returning `{ path, category, exports: string[] }` per result.

---

### P3 — Low

**No tag discovery.**
The query DSL filters by tag name but the AI cannot discover what tags exist in a project graph before querying. Speculative queries like `tag:auth` silently return zero results if the tag was never assigned.

Add `list_tags({ root })` → `{ name: string; count: number }[]`.

**`find_unused` cannot reuse the cached graph.**
Unlike `detect_features` and `query`, it requires explicit `entryPoints` and always rebuilds. Make `entryPoints` optional (reuse cache when omitted) for consistency with other tools.

**`slim` mode silently drops function-kind tags.**
Only `comment-marker` and `import` tags are kept (`src/mcp/handlers.ts:347–349`). Querying for `tag:parseFile` on slim output returns nothing even though the tag exists. Document this in the tool schema `slim` description.

---

## Summary table

| Priority | Gap | Files to change | Effort |
|---|---|---|---|
| P1 | Cache invalidation / refresh tool | `src/mcp/tools.ts`, `src/mcp/handlers.ts`, `src/mcp/cache.ts` | Medium |
| P2 | `withMeta` option on traversal tools | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | Small |
| P2 | Symbol-level lookup (`find_symbol`) | `src/mcp/tools.ts`, `src/mcp/handlers.ts`, `src/graph/model.ts` | Medium |
| P3 | `list_tags` discovery tool | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | Small |
| P3 | `find_unused` cache reuse | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | Small |
| P3 | Document `slim` tag filtering | `src/mcp/tools.ts` | Low |
