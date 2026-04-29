# mokosh — Dependency Graph Analysis

The mokosh MCP server is **always active** in this project (configured via `.mcp.json`). Use MCP tools directly — they return targeted results and avoid loading the full graph into context. Fall back to the CLI only when you need a full-graph visualization the user will read.

## Tool call order

`analyze` must be called once per session before any other tool. It builds and caches the graph.

```
analyze({ root: "<abs-path>", entryPoints: ["src/index.ts"] })
```

Returns a one-line summary (node count, categories, cycles). That is all you need from it.

## Use case → cheapest tool

| Goal | MCP call | Notes |
|------|----------|-------|
| What does file X import? | `get_dependencies({ root, file, depth: 1 })` | depth=1 = immediate only |
| Full transitive deps of X | `get_dependencies({ root, file })` | omit depth |
| Who imports file X directly? | `get_dependents({ root, file })` | one-hop incoming |
| Full blast radius if X changes | `get_affected({ root, file })` | full incoming traversal |
| Tests affected by X | `get_affected({ root, file, testsOnly: true })` | |
| Tags to run after git diff | `propose_tags({ root })` | reads git diff automatically |
| Test paths after git diff | `propose_affected_tests({ root })` | pipe into vitest |
| High-degree hubs | `detect_features({ root })` | |
| Filter graph by category/tag | `query({ root, filter: "category:logic" })` | |
| Unused files | `find_unused({ root, entryPoints: [...] })` | |

## CLI fallback (visualization only)

Use the CLI only when the user asks to **see** the full graph or a Mermaid diagram:

```bash
node ./dist/cli.js <entry-point> --mermaid
node ./dist/cli.js <entry-point> --query "category:logic"
node ./dist/cli.js --find-unused <entry-point>
```

If `dist/` is missing, run `npm run build` first, then retry.

**Do not** run the CLI just to answer a dependency question — the MCP tools return the answer directly with far fewer tokens.

## Reading results

- `get_affected` / `get_dependents` return a flat list of paths — use that list directly; do not re-read the graph.
- `analyze` summary is enough to confirm the graph built; do not request the full serialized graph unless explicitly needed.
- For cycles: the `analyze` summary includes cycle count; only call `check-cycles` CLI if you need the actual cycle members.