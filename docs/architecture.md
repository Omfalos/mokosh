# Architecture Overview

Mokosh is built from three cooperating layers: a **parser tier** that turns raw source files into structured data, a **graph engine** that builds and traverses the dependency network, and a **consumer tier** (CLI and MCP server) that exposes results to users and agents.

## The Pipeline

```
Entry points
    │
    ▼
GraphBuilder.build()                    src/graph/builder.ts
  ├─ Walks FS depth-first from each entry point
  ├─ For each file:
  │   ├─ parseFile()                    src/parser.ts → registry → lang parser
  │   ├─ resolveImports()               src/graph/resolver.ts
  │   │    Turns raw specifiers into project-relative paths
  │   │    Recurses into each local dependency
  │   ├─ Reuses node if mtime+size unchanged (incremental build)
  │   └─ Annotates external imports with lock-file versions
  │
  ▼
Enrichment (post-build)                 src/graph/enrichment.ts
  ├─ enrichCoverage          → adds coveragePct from Istanbul summary JSON
  ├─ enrichExportUsage       → computes exportUsageRatio per import edge
  ├─ enrichLibraryTags       → adds import-kind tags for third-party libs
  ├─ enrichTestedBy          → links test files back to their logic subjects
  └─ enrichTestNodeTags      → tags test nodes with the modules they exercise
    │
    ▼
Graph / WorkspaceGraph                  src/graph/model.ts, workspace-model.ts
  Map<relPath, FileNode>
```

For monorepos, `createWorkspaceGraph()` runs `detectMonorepo()` first (detects Turborepo → Nx → pnpm → Yarn → npm in priority order), then builds one `Graph` per package, wraps them in a `WorkspaceGraph`, and preserves cross-package edges via `ImportEdge.isWorkspace`. See [Monorepo Support](./monorepo.md).

---

## 1. Parser (`src/parser/`)

Responsibility: analyse a single file and return its imports, exports, tags, and category.

### Language support

- **TypeScript / JavaScript** (`src/parser/lang/typescript.ts`): Uses the TypeScript Compiler API to walk the AST. Recognises `import`, `export … from`, dynamic `import()`, `require()`, re-exports, and call expressions.
- **Python** (`src/parser/lang/python.ts`): Uses `@lezer/python` — the CodeMirror 6 pure-JavaScript LR parser (no native binaries). Supports all import forms. See [ADR-002](adr-002-python-parsing.md).
- **Style files** (`src/parser/style/`): Uses `postcss`, `sass`, and `stylus` ASTs rather than regex. See [ADR-001](adr-001-styles-parsing.md).
- **CoffeeScript, LiveScript, Lua, Gherkin**: Purpose-built parsers in `src/parser/lang/`.

### What the parser extracts

- **Imports**: `ImportEdge[]` with `rawSpecifier`, `type` (static/dynamic/require/re-export), `symbols`, `isExternal`, `isWorkspace`.
- **Exports**: `ExportedSymbol[]` — `{ name, doc?, flags?, signature? }`. `doc` is the JSDoc description text; `flags` captures lifecycle markers (`deprecated`, `internal`, `public`, `alpha`, `beta`); `signature` is the serialised type signature.
- **Tags**: `StructuredTag[]` — `{ name, kind }` where `kind` is one of: `function`, `class`, `variable`, `type`, `import`, `comment-marker`. Five extraction strategies — see [Test Tags](./test-tags.md).
- **Category**: `logic | ui | test | config | barrel | type-only | other` — inferred from imports, exports, naming, and file content.
- **File description**: The JSDoc comment on the first statement of a JS/TS file is stored as `node.description`, enabling `hasDocstring` queries.
- **Call edges** (TS/JS non-test files): Cross-file function calls are recorded as `CallEdge { from, to, toFile }` on `FileNode.callEdges`. After path resolution in `GraphBuilder` they become queryable via `graph.getCallers()` and `graph.traverseCalls()`.

### Complexity metrics (`src/parser/complexity.ts`)

For TypeScript and JavaScript files, the parser computes:
- **McCabe cyclomatic complexity** — counts independent decision paths (base 1): `if`, ternary, loops, `switch case`, `catch`, `&&`/`||`/`??`.
- **Cognitive complexity** — nesting-penalised difficulty score. Structural nodes add `1 + depth` and increase nesting; `else if` / `else` and logical operators add 1 with no nesting bonus.

Both are stored on `FileNode` as `complexity` and `cognitiveComplexity`.

---

## 2. Graph Engine (`src/graph/`)

### GraphBuilder

Walks the file system recursively from entry points, builds a `DependencyGraph` in memory:

- **Incremental builds**: Takes an optional previous `Graph`. Nodes whose `mtime` and `size` are unchanged are reused as-is — only changed files are re-parsed.
- **Automatic test discovery**: After the entry-point walk, the builder scans for test files by filename pattern and processes any not yet visited, so `testedBy` enrichment is complete even when test files are not imported from library entry points.
- **External dependencies**: `node_modules` and paths outside the project root are added as metadata but not traversed.
- **Git stats** (opt-in): When `gitStats: true`, populates `commitCount90d` and `lastAuthor` on each cache-missed node via `git log`.
- **Lock file versions**: When a lock file is present, each external import edge is annotated with the installed version.

### Graph class (`src/graph/model.ts`)

Wraps `Map<string, FileNode>` with:

| Method | Description |
|--------|-------------|
| `traverse(path, visitor, opts)` | DFS over import edges. `direction: 'outgoing'` (default) or `'incoming'` (reverse). |
| `traverseCalls(path, visitor, opts)` | DFS over call edges. Same direction options. |
| `getNeighbors(path)` | First-hop outgoing import neighbours as `FileNode[]`. |
| `getCallers(path)` | One-hop incoming call-edge sources as `string[]`. |
| `findCycles()` | Returns arrays of cyclic paths. |
| `findUnusedFiles(allFiles)` | Files that exist on disk but are not reachable from any entry point. |
| `serialize()` / `Graph.deserialize()` | JSON round-trip for disk caching. |

### Enrichment (`src/graph/enrichment.ts`)

Five post-build passes, all mutating nodes in place:

| Function | What it adds |
|----------|-------------|
| `enrichCoverage` | `node.coveragePct` from an Istanbul `coverage-summary.json` |
| `enrichExportUsage` | `ImportEdge.exportUsageRatio` (fraction of exports consumed); `node.avgExportUsage`, `node.maxExportUsage` |
| `enrichLibraryTags` | `import`-kind tag for each third-party library a file imports |
| `enrichTestedBy` | `node.testedBy` array on logic/barrel nodes — which test files directly import them |
| `enrichTestNodeTags` | Adds `import`-kind tags to test nodes derived from basenames of their local imports |

### WorkspaceGraph (`src/graph/workspace-model.ts`)

Container for monorepo graphs. See [Monorepo Support](./monorepo.md).

### Feature Hub Detection (`src/graph/features/`)

Identifies files with high **out-degree** (many internal imports) — orchestrators and aggregators like `src/parser.ts` or `src/cli/runner.ts`. These receive a `feature:<name>` tag and act as traversal boundaries in the tag proposal system.

### Resolver (`src/graph/resolver.ts`)

`DefaultResolver` turns raw import specifiers into absolute file paths. Handles:
- Relative paths with extension probing
- `tsconfig.json` path aliases and `baseUrl`
- Node.js module resolution (`node_modules`)
- Workspace package names (cross-package `isWorkspace` edges)

---

## 3. Tag Management (`src/tags/`)

- **`proposeTags(graph, changedFiles, opts)`**: Backward-traverses from each changed file to find affected test suites, then returns their tags. Feature hub files short-circuit traversal — when a hub is reached its `feature:<name>` tag is emitted and the branch stops.
- **`proposeAffectedTests(graph, changedFiles, opts)`**: Same traversal but returns test file paths instead of tags.
- **Git integration**: `getGitDiffFiles()` reads `git diff --name-only` to identify changed files when none are passed explicitly.

---

## 4. Exporters (`src/exporters/`)

- **`MermaidExporter` / `toMermaid()`**: Serialises a graph (or filtered subset) to a `graph TD` Mermaid diagram. Style nodes get distinct styling.

---

## 5. Query Engine (`src/query/`)

A lightweight filter DSL. `parseQuery(str)` turns a comma-separated `key:value` string into a `NodeQuery` predicate set; `filterGraph(serialized, query)` applies it to a serialised graph. See [Query Language](./query.md) for the full key reference.

---

## 6. Coverage (`src/coverage.ts`)

`loadCoverageMap(rootDir, reportPath)` reads an Istanbul `coverage-summary.json` and returns `Map<relPath, lineCoveragePct>`. Pass this to `createImportMap()` via the `coverageMap` option — `GraphBuilder` passes it to `enrichCoverage` after the build.

---

## Data Flow

```
1. Input          Entry point paths + optional config
2. Build          GraphBuilder → parseFile (per lang parser) → resolveImports → Graph
3. Enrich         enrichCoverage, enrichExportUsage, enrichLibraryTags, enrichTestedBy, enrichTestNodeTags
4. Output         CLI → JSON / Mermaid / tag list
                  MCP server → tool responses for get_dependencies, get_affected, query, …
```