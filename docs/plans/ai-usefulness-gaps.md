# Plan: AI Usefulness Gaps

Analysis of mokosh's current usefulness for AI agents (Claude Code / MCP clients), with gaps ranked by priority.

## What works well

- **MCP-first architecture** — AI agents call tools natively; no CLI round-trips needed.
- **`slim: true` mode** — compact node responses keep token cost low.
- **Call graph with symbol precision** — `get_callers({ withEdgeDetail: true })` gives function-to-function edges, rare among dependency tools.
- **`propose_affected_tests`** — output is test paths ready to pipe into vitest; no further AI reasoning required.
- **Export usage ratios** (`avgExportUsage`, `maxExportUsage`) + `testedBy` reverse-index — surface dead exports and test coverage at node level.
- **Rich query DSL** — 14+ filter dimensions including `minCoverage`, `minExportUsage`, `sort:commitCount90d`.
- **`find_symbol`** — symbol-level reverse lookup (defining file + best-available caller/importer info per match) in one call. *(Shipped — was the P2 "no symbol-level reverse lookup" gap below.)*
- **`withMeta` on `get_dependencies`/`get_dependents`/`get_affected`** — `{ path, category, exports }` per result instead of bare paths. *(Shipped — was the P2 "bare paths only" gap below.)*
- **Session-scoped cache invalidation/refresh** (`src/mcp/cache.ts`) — `SessionState.invalidate`, file-watch-driven `dirtyRoots`, and `ensureFresh`/`ensureFreshWorkspace` transparently rebuild incrementally when source files change mid-session. *(Shipped — was the P1 "cache invalidation / refresh tool" gap.)*

---

## Gaps

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
| P3 | `list_tags` discovery tool | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | Small |
| P3 | `find_unused` cache reuse | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | Small |
| P3 | Document `slim` tag filtering | `src/mcp/tools.ts` | Low |

**Shipped since this plan was written:** cache invalidation/refresh (P1), `withMeta` on traversal tools (P2), `find_symbol` (P2) — see "What works well" above.
