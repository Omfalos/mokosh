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
| Filter graph by category/tag | `query({ root, filter: "category:logic" })` | see filter reference below |
| Unused files | `find_unused({ root, entryPoints: [...] })` | |

## Query filter reference

Use with `query({ root, filter: "..." })` via MCP or `--query "..."` via CLI.
All keys are **case-insensitive**. Multiple keys are **AND'd** together.

| Key | Type | Match logic | Example |
|-----|------|-------------|---------|
| `category` | string | exact; `!` = negate | `category:logic`, `category:!test` |
| `type` | string | exact; `!` = negate | `type:typescript`, `type:!css` |
| `tag` | string | OR across multiple entries; `!` = exclude | `tag:auth`, `tag:!generated` |
| `tag` (AND) | string | `+`-separated = all must match | `tag:auth+core` |
| `path` | string | substring; `!` = negate | `path:src/api`, `path:!__tests__` |
| `external` | bool | has ≥1 external import | `external:true` |
| `importsFile` | string | directly imports a file whose path contains the substring | `importsFile:src/utils` |
| `importedBy` | string | directly imported by a file whose path contains the substring | `importedBy:src/index` |
| `minImports` | number | out-degree ≥ N | `minImports:5` |
| `maxImports` | number | out-degree ≤ N | `maxImports:2` |
| `minSize` | number | file size ≥ N bytes | `minSize:1024` |
| `maxSize` | number | file size ≤ N bytes | `maxSize:4096` |
| `hasDocstring` | bool | has/lacks JSDoc `description` on first statement | `hasDocstring:false` |
| `sort` | enum | sort descending: `size`, `imports`, or `commitCount90d` | `sort:imports` |
| `limit` | number | max results after filtering + sorting | `limit:20` |

**`category` values:** `logic` · `ui` · `test` · `config` · `barrel` · `type-only` · `other`

## Common AI query patterns

```
# Token-efficient context: only logic files, no tests/barrels/types
query({ root, filter: "category:logic" })

# Files that need documentation
query({ root, filter: "category:logic,hasDocstring:false" })

# Most-imported files in a subsystem (complexity signal)
query({ root, filter: "path:src/api,sort:imports,limit:10" })

# Large files to watch before a refactor
query({ root, filter: "category:logic,sort:size,limit:10" })

# Everything that depends on a specific library
query({ root, filter: "tag:react,category:logic" })

# Files that directly import a specific module
query({ root, filter: "importsFile:src/auth/session" })

# Recently active files (requires gitStats: true in config)
query({ root, filter: "category:logic,sort:commitCount90d,limit:20" })
```

## CLI fallback (visualization only)

Use the CLI only when the user asks to **see** the full graph or a Mermaid diagram:

```bash
node ./dist/cli.js <entry-point> --mermaid
node ./dist/cli.js <entry-point> --query "category:logic"
node ./dist/cli.js --query-help        # full filter key reference
node ./dist/cli.js --find-unused <entry-point>
```

If `dist/` is missing, run `npm run build` first, then retry.

**Do not** run the CLI just to answer a dependency question — the MCP tools return the answer directly with far fewer tokens.

## Reading results

- `get_affected` / `get_dependents` return a flat list of paths — use that list directly; do not re-read the graph.
- `analyze` summary is enough to confirm the graph built; do not request the full serialized graph unless explicitly needed.
- For cycles: the `analyze` summary includes cycle count; only call `check-cycles` CLI if you need the actual cycle members.
- `tags` on nodes are structured objects `{ name, kind }` — match by `tag.name` when reading results.
- `exports` on nodes are structured objects `{ name, doc?, flags?, signature? }` — useful for symbol-level context.