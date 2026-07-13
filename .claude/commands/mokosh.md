# mokosh — Dependency Graph Analysis

The mokosh MCP server is **always active** in this project (configured via `.mcp.json`). Use MCP tools directly — they return targeted results and avoid loading the full graph into context. Fall back to the CLI only when you need a full-graph visualization the user will read.

## Tool call order

`analyze` must be called once per session before any other tool (except `find_unused` and `query` with explicit `entryPoints`, which can build their own graph). It builds and caches the graph, keyed by `root`.

```
analyze({ root: "<abs-path>", entryPoints: ["src/index.ts"] })
```

Returns a one-line summary (node count, categories, cycles). That is all you need from it.

For monorepos, pass `entryPoints: []` to auto-detect the workspace layout (Turborepo/Nx/pnpm/Yarn/npm) and build one graph per package — then use `get_workspace_packages` / `get_workspace_affected`.

If you edit source files mid-session, call `clear_cache({ root })` before re-querying — otherwise every tool reasons from the stale pre-edit graph.

## Use case → tool

### Dependency traversal

| Goal | MCP call | Notes |
|------|----------|-------|
| What does file X import? | `get_dependencies({ root, file, depth: 1 })` | depth=1 = immediate only |
| Full transitive deps of X | `get_dependencies({ root, file })` | omit depth |
| Who imports file X directly? | `get_dependents({ root, file })` | one-hop incoming |
| Full blast radius if X changes | `get_affected({ root, file })` | full incoming traversal |
| Blast radius, faster on repeat | `get_affected({ root, file, cached: true })` | O(1) lookup cache, built lazily |
| Blast radius for specific symbols | `get_affected({ root, file, changedSymbols: [...] })` | restricts to files importing those symbols |
| Tests affected by X | `get_affected({ root, file, testsOnly: true })` | |
| Who **calls into** X at runtime? | `get_callers({ root, file, depth: 1, withEdgeDetail: true })` | call-graph, not just imports — more precise than `get_affected` |
| Callers/callees of a named function | `get_call_graph({ root, function: "parseFile" })` | TS/JS only; always needs a function name |
| Unused files | `find_unused({ root, entryPoints: [...] })` | files unreachable from entry points |

### Quality signals

| Goal | MCP call | Notes |
|------|----------|-------|
| Undertested files | `find_uncovered({ root, coverageThreshold })` | needs `coverageReportPath` in mokosh.config |
| Complexity hotspots | `find_complex_functions({ root, metric, threshold, limit })` | `metric`: `cognitiveComplexity` (default) or `complexity`; TS/JS only |
| High-degree hubs / orchestrators | `detect_features({ root })` | sorted by import count |
| What does each file own? | `get_module_responsibility({ root, paths? })` | semantic role, JSDoc, exports, owning feature hub |
| Group files by owning feature | `get_feature_graph({ root, minOutDegree })` | cheapest way to answer "what's in feature X" |

### Types and API surface

| Goal | MCP call | Notes |
|------|----------|-------|
| Inventory of all types | `get_type_graph({ root })` | interfaces/classes/enums/aliases, TS/JS only |
| Who uses type T? | `get_type_graph({ root, type: "FileNode" })` | usedByFiles + uses |
| Resolved public API of a library | `get_api_surface({ root, entryPoints? })` | expands `export *` chains; omit entryPoints to auto-detect from package.json |

### Monorepo

| Goal | MCP call | Notes |
|------|----------|-------|
| List packages + inter-package deps | `get_workspace_packages({ root })` | requires prior `analyze({ root, entryPoints: [] })` |
| Cross-package blast radius | `get_workspace_affected({ root, file })` | file path relative to monorepo root |

### Tags & CI

| Goal | MCP call | Notes |
|------|----------|-------|
| Tags to run after git diff | `propose_tags({ root })` | reads git diff automatically; `format: "tags"` (default) |
| Test paths after git diff | `propose_tags({ root, format: "paths" })` | pipe straight into a test runner (e.g. vitest) |
| Write `@tag` annotations into test files | `apply_tags({ root, dryRun? })` | idempotent `<mokosh-tags>` block; `dryRun: true` to preview |

### Ad-hoc graph queries

| Goal | MCP call | Notes |
|------|----------|-------|
| Filter graph by category/tag/etc. | `query({ root, filter: "category:logic" })` | see filter reference below |

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
| `minCoverage` | number | line coverage % ≥ N | `minCoverage:80` |
| `maxCoverage` | number | line coverage % ≤ N | `maxCoverage:50` |
| `minExportUsage` | number | avg export-usage ratio ≥ N | `minExportUsage:0.5` |
| `maxExportUsage` | number | avg export-usage ratio ≤ N | `maxExportUsage:0.1` |
| `sort` | enum | sort descending: `size`, `imports`, `commitCount90d`, or `exportUsage` | `sort:imports` |
| `limit` | number | max results after filtering + sorting | `limit:20` |

**`category` values:** `logic` · `ui` · `test` · `config` · `barrel` · `type-only` · `other`

`query` defaults to `slim: true` (compact nodes: flat `importsFiles` path list, export names, meaningful tags only, no edge objects/mtime/size). Pass `slim: false` only when full edge metadata is needed. `entryPoints` can be omitted to reuse the cached graph from `analyze`.

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

# Under-covered, rarely-used exports (dead-weight candidates)
query({ root, filter: "maxCoverage:20,maxExportUsage:0.1" })
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

- `get_affected` / `get_dependents` / `get_callers` return a flat list of paths (or path+function pairs) — use that list directly; do not re-read the graph.
- `analyze` summary is enough to confirm the graph built; do not request the full serialized graph unless explicitly needed.
- For cycles: the `analyze` summary includes cycle count; only call `check-cycles` CLI if you need the actual cycle members.
- `tags` on nodes are structured objects `{ name, kind }` — match by `tag.name` when reading results.
- `exports` on nodes are structured objects `{ name, doc?, flags?, signature? }` — useful for symbol-level context.
- Call `clear_cache({ root })` after editing files mid-session, before the next query tool call.