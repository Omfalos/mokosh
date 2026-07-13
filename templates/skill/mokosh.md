# mokosh — Dependency Graph Analysis

mokosh is a dependency-graph analysis tool for this project, available either as an MCP server or a CLI. Detect which is available and use that.

## Which mode is active?

- **MCP available** — if tools named `mcp__mokosh__*` (e.g. `mcp__mokosh__analyze`, `mcp__mokosh__get_affected`) are visible in this session, use them directly. They return targeted results without loading the full graph into context.
- **MCP not available** — fall back to the CLI. Run `npx mokosh <entry-point> [flags]` (or bare `mokosh` if it's a project devDependency). Use `npx mokosh --help` and `npx mokosh --query-help` to see the full flag/filter reference.

Prefer MCP over the CLI whenever both are available — it's cheaper in tokens and doesn't require picking entry points manually. Only fall back to the CLI for full-graph visualizations (Mermaid diagrams) the user will read directly.

## MCP: tool call order

`analyze` must be called once per session before any other tool (except `find_unused` and `query` with explicit `entryPoints`, which can build their own graph). It builds and caches the graph, keyed by `root`.

```
analyze({ root: "<abs-path>", entryPoints: ["src/index.ts"] })
```

Returns a one-line summary (node count, categories, cycles) — that's all you need from it.

For monorepos, pass `entryPoints: []` to auto-detect the workspace layout (Turborepo/Nx/pnpm/Yarn/npm) and build one graph per package — then use `get_workspace_packages` / `get_workspace_affected`.

If source files are edited mid-session, call `clear_cache({ root })` before re-querying — otherwise every tool reasons from the stale pre-edit graph.

## Use case → tool (MCP) / flag (CLI)

### Dependency traversal

| Goal | MCP call | CLI equivalent |
|------|----------|-----------------|
| What does file X import? | `get_dependencies({ root, file, depth: 1 })` | `mokosh <entry> --query "path:X"` then inspect `importsFiles` |
| Full transitive deps of X | `get_dependencies({ root, file })` | — |
| Who imports file X directly? | `get_dependents({ root, file })` | — |
| Full blast radius if X changes | `get_affected({ root, file })` | — |
| Blast radius, faster on repeat | `get_affected({ root, file, cached: true })` | — |
| Blast radius for specific symbols | `get_affected({ root, file, changedSymbols: [...] })` | — |
| Tests affected by X | `get_affected({ root, file, testsOnly: true })` | `mokosh --affected-tests <file>` |
| Who **calls into** X at runtime? | `get_callers({ root, file, depth: 1, withEdgeDetail: true })` | `mokosh --callers <file>` |
| Callers/callees of a named function | `get_call_graph({ root, function: "name" })` | TS/JS only |
| Unused files | `find_unused({ root, entryPoints: [...] })` | `mokosh --find-unused <entry>` |
| Circular dependencies | — | `mokosh <entry> --check-cycles` |

### Quality signals

| Goal | MCP call | CLI equivalent |
|------|----------|-----------------|
| Undertested files | `find_uncovered({ root, coverageThreshold })` | `mokosh --find-uncovered <entry>` |
| Complexity hotspots | `find_complex_functions({ root, metric, threshold, limit })` | — |
| High-degree hubs / orchestrators | `detect_features({ root })` | `mokosh <entry> --detect-features` |
| What does each file own? | `get_module_responsibility({ root, paths? })` | — |
| Group files by owning feature | `get_feature_graph({ root, minOutDegree })` | — |

### Types and API surface

| Goal | MCP call |
|------|----------|
| Inventory of all types | `get_type_graph({ root })` |
| Who uses type T? | `get_type_graph({ root, type: "TypeName" })` |
| Resolved public API of a library | `get_api_surface({ root, entryPoints? })` |

### Monorepo

| Goal | MCP call |
|------|----------|
| List packages + inter-package deps | `get_workspace_packages({ root })` (requires prior `analyze({ root, entryPoints: [] })`) |
| Cross-package blast radius | `get_workspace_affected({ root, file })` |

### Tags & CI

| Goal | MCP call | CLI equivalent |
|------|----------|-----------------|
| Tags to run after git diff | `propose_tags({ root })` | `mokosh --propose-tags <entry>` |
| Test paths after git diff | `propose_tags({ root, format: "paths" })` | — |
| Write `@tag` annotations into test files | `apply_tags({ root, dryRun? })` | — |

### Ad-hoc graph queries

| Goal | MCP call | CLI equivalent |
|------|----------|-----------------|
| Filter graph by category/tag/etc. | `query({ root, filter: "category:logic" })` | `mokosh <entry> --query "category:logic"` |

## Query filter reference

Use with `query({ root, filter: "..." })` via MCP or `--query "..."` via CLI. All keys are case-insensitive; multiple keys are AND'd together.

| Key | Example |
|-----|---------|
| `category` | `category:logic`, `category:!test` |
| `type` | `type:typescript`, `type:!css` |
| `tag` (OR/exclude) | `tag:auth`, `tag:!generated` |
| `tag` (AND) | `tag:auth+core` |
| `path` | `path:src/api`, `path:!__tests__` |
| `external` | `external:true` |
| `importsFile` | `importsFile:src/utils` |
| `importedBy` | `importedBy:src/index` |
| `minImports` / `maxImports` | `minImports:5`, `maxImports:2` |
| `minSize` / `maxSize` | `minSize:1024`, `maxSize:4096` |
| `hasDocstring` | `hasDocstring:false` |
| `minCoverage` / `maxCoverage` | `minCoverage:80`, `maxCoverage:50` |
| `minExportUsage` / `maxExportUsage` | `minExportUsage:0.5`, `maxExportUsage:0.1` |
| `sort` | `sort:imports`, `sort:size`, `sort:commitCount90d`, `sort:exportUsage` |
| `limit` | `limit:20` |

`category` values: `logic` · `ui` · `test` · `config` · `barrel` · `type-only` · `other`.

`query` (MCP) defaults to `slim: true` — compact nodes with flat `importsFiles`, export names, and meaningful tags only. Pass `slim: false` only when full edge metadata is needed.

Run `mokosh --query-help` (CLI) for the full reference at any time.

## Reading results

- `get_affected` / `get_dependents` / `get_callers` return a flat list of paths — use it directly, don't re-read the graph.
- `analyze`'s one-line summary is enough to confirm the graph built.
- `tags` on nodes are `{ name, kind }` objects — match by `tag.name`.
- `exports` on nodes are `{ name, doc?, flags?, signature? }` objects.
- Call `clear_cache({ root })` (MCP) after editing files mid-session, before the next query.
