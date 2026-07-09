# mokosh — codebase guide

## What it is

A dependency-graph analysis tool. Parses source files, builds a directed import graph, and exposes it via CLI and MCP server. Two published outputs: a CLI binary and an MCP server.

> **Not yet published to npm.** Build locally with `npm install && npm run build`.

## How it works (the pipeline)

```
Entry points
    │
    ▼
GraphBuilder.build()          ← src/graph/builder.ts
  │  Walks FS from entry points (depth-first)
  │  For each file:
  │    parseFile()             ← src/parser.ts → parser registry → lang parser
  │    resolveImports()        ← src/graph/resolver.ts
  │      Turns raw specifiers into absolute paths
  │      Recurses into each local dependency
  │    Reuses node if mtime+size unchanged (incremental build)
  │    Annotates external imports with lock-file versions
  │
  ▼
Graph / WorkspaceGraph         ← src/graph/model.ts, src/graph/workspace-model.ts
  │  Map<relPath, FileNode>
  │  Each FileNode carries: imports[], exports[], tags[], category, type,
  │    mtime/size, optional: commitCount90d, lastAuthor, coveragePct,
  │    complexity, cognitiveComplexity, callEdges
  │
  ▼
Enrichment (post-build)        ← src/graph/enrichment.ts
  │  enrichCoverage            Adds coveragePct from Istanbul summary JSON
  │  enrichExportUsage         Computes exportUsageRatio per import edge
  │  enrichLibraryTags         Adds import-kind tags for third-party libs
  │  enrichTestedBy            Links test files back to their subjects
  │  enrichTestNodeTags        Tags test nodes with the files they test
  │
  ▼
Consumers
  CLI (src/cli/)               JSON / Mermaid output, flag-driven commands
  MCP server (src/mcp/)        Tool-call interface for AI assistants
```

For monorepos, `createWorkspaceGraph()` runs `detectMonorepo()` first (tries Turborepo → Nx → pnpm → Yarn → npm detectors in priority order), then builds one `Graph` per package and wraps them in a `WorkspaceGraph`. Cross-package edges are preserved via `ImportEdge.isWorkspace`.

## Entry points

| Entry | Purpose |
|-------|---------|
| `src/index.ts` | Public library API — `createImportMap`, `createWorkspaceGraph`, `getAllProjectFiles` |
| `src/cli.ts` → `src/cli/runner.ts` | CLI binary |
| `src/mcp.ts` → `src/mcp/server.ts` | MCP server |

## Key architectural hubs (high blast radius)

- **`src/types/`** — `node.ts`, `graph.ts`, `parse.ts` — imported by almost every file; split from the former `src/types.ts`
- **`src/index.ts`** — re-exports everything used by CLI and MCP; changes here affect both consumers
- **`src/parser.ts`** — aggregates all language parsers; changes affect the graph builder
- **`src/graph/builder.ts`** — core traversal logic; changes here affect how all graphs are built

## Module map

```
src/
  index.ts            public API: createImportMap, createWorkspaceGraph, getAllProjectFiles
  const.ts            DEFAULT_EXTENSIONS, DEFAULT_IGNORE_DIRS, ScanOptions
  coverage.ts         loadCoverageMap — reads Istanbul coverage-summary.json
  types.ts            thin re-export of src/types/*
  config.ts           mokosh.config.* loading
  git.ts              git diff helpers (commitCount90d, lastAuthor)
  graph.ts            thin re-export of src/graph/
  parser.ts           aggregates all language parsers

  types/
    node.ts           FileNode, ImportEdge, ExportedSymbol, CallEdge, StructuredTag
    graph.ts          SerializedGraph, DependencyGraph, TraversalVisitor/Options
    parse.ts          FileType, ImportType, NodeCategory, TagKind enums

  exporters/
    types.ts          GraphExporter interface
    mermaid.ts        MermaidExporter, toMermaid()
    index.ts          re-export

  graph/
    builder.ts        GraphBuilder — walks FS, calls parsers, builds Graph
    model.ts          Graph class — traverse, findCycles, serialize/deserialize
    analyzer.ts       GraphAnalyzer — in/out-degree analysis
    enrichment.ts     enrichCoverage, enrichExportUsage, enrichLibraryTags, enrichTestedBy, enrichTestNodeTags
    resolver.ts       DefaultResolver — turns import specifiers into file paths (relative, tsconfig aliases, node_modules)
    index.ts          re-export of all graph/* modules
    workspace/        monorepo detection
      types.ts        WorkspacePackage, MonorepoLayout
      registry.ts     registerMonorepoDetector, getMonorepoDetectors
      shared.ts       shared helpers across detectors
      fs-utils.ts     FS utilities for detectors
      index.ts        detectMonorepo() — runs detectors in priority order
      detectors/      turborepo, nx, pnpm, yarn, npm (one file each)
    workspace-model.ts  WorkspaceGraph — holds per-package graphs, cross-package traversal
    features/
      index.ts        detectFeatures() — finds high-out-degree orchestrator/aggregator files

  parser/
    types.ts          parser-local types (ParseResult, etc.)
    registry.ts       parser registry — maps extension → parser
    file-type.ts      extension → FileType enum
    classify.ts       file category classification (logic/barrel/type-only/test)
    complexity.ts     computeComplexity — McCabe cyclomatic + cognitive complexity for TS/JS
    utils.ts          shared parser utilities
    lockfile.ts       package-lock.json / yarn.lock / pnpm-lock.yaml parser
    lang/
      typescript.ts   TypeScript/JavaScript via tsc compiler API
      python.ts       Python via @lezer/python (pure-JS LR parser — see docs/adr-002-python-parsing.md)
      coffee.ts       CoffeeScript
      gherkin.ts      Gherkin/Cucumber (.feature files)
      ls.ts           LiveScript
      lua.ts          Lua
    style/
      barrel.ts       style parser aggregator
      css.ts          CSS
      scss.ts         SCSS/Sass
      stylus.ts       Stylus
      index.ts        re-export
    tagging/          AST tag-collection strategies
      index.ts        collects tags from declaration names, @markers, comments, option-bags

  query/
    filter.ts         filterGraph() — applies NodeQuery predicates to a graph
    index.ts          parseQuery(), NodeQuery type

  tags/
    proposer.ts       proposeTagsFromDiff() — suggests test tags from git diff
    identifier.ts     identifies tags already present on nodes
    index.ts          re-export

  mcp/
    server.ts         MCP server setup (stdio transport)
    handlers.ts       one handler per MCP tool
    tools.ts          JSON Schema definitions for all MCP tools
    cache.ts          session graph cache (keyed by rootDir)
    utils.ts          response helpers

  cli/
    runner.ts         command dispatch — reads parsed args, calls the right command
    args.ts           CLI arg parsing
    config.ts         config loading for CLI
    graph-loader.ts   graph build + disk cache for CLI
    help.ts           HELP_TEXT and QUERY_HELP_TEXT constants
    const.ts          CLI-specific constants
    commands/
      graph-output.ts   default JSON/Mermaid output
      affected-tests.ts --affected-tests
      callers.ts        --callers
      check-cycles.ts   --check-cycles
      detect-features.ts --detect-features
      find-uncovered.ts --find-uncovered
      find-unused.ts    --find-unused
      propose-tags.ts   --propose-tags
      types.ts          shared command types
      utils.ts          shared command utilities
```

## Core data types

**`FileNode`** (`src/types/node.ts`) — one node per source file:
- `path` — project-relative path (the graph key)
- `type` — language (`typescript`, `python`, `css`, …)
- `category` — role: `logic | ui | test | config | barrel | type-only | other`
- `imports: ImportEdge[]` — outgoing edges; each edge has `toPath`, `rawSpecifier`, `symbols`, `isExternal`, `isWorkspace`
- `exports: ExportedSymbol[]` — named exports with optional doc/signature
- `tags: StructuredTag[]` — semantic labels (kind: `declaration | import | marker | comment | option-bag`)
- Optional enriched fields: `commitCount90d`, `lastAuthor`, `coveragePct`, `complexity`, `cognitiveComplexity`, `callEdges`, `avgExportUsage`, `maxExportUsage`

**`Graph`** (`src/graph/model.ts`) — wraps `Map<string, FileNode>`:
- `traverse(startPath, visitor, opts)` — DFS/BFS in outgoing or incoming direction
- `findCycles()` — returns arrays of cyclic paths
- `serialize()` / `Graph.deserialize()` — JSON round-trip

**`WorkspaceGraph`** (`src/graph/workspace-model.ts`) — monorepo container:
- `packages: Map<name, { graph, pkg }>` — one `Graph` per workspace package
- `getAffectedAcrossPackages(relPath)` — cross-package blast-radius analysis
- `getPackageDependencies()` — package-level dep map

## Query DSL

`--query "key:value,key:value"` (AND across keys). Key reference:

| Key | Example |
|-----|---------|
| `category:<value>` | `category:logic`, `category:!test` |
| `type:<value>` | `type:typescript` |
| `tag:<value>` | `tag:auth`, `tag:!generated`, `tag:auth+core` (AND) |
| `path:<substr>` | `path:src/api`, `path:!__tests__` |
| `importsFile:<substr>` | `importsFile:src/utils/logger` |
| `importedBy:<substr>` | `importedBy:src/index` |
| `minImports:<N>` / `maxImports:<N>` | `minImports:5` |
| `minSize:<bytes>` / `maxSize:<bytes>` | `maxSize:4096` |
| `hasDocstring:<bool>` | `hasDocstring:false` |
| `external:<bool>` | `external:true` |
| `sort:<field>` | `sort:imports`, `sort:size`, `sort:commitCount90d` |
| `limit:<N>` | `limit:20` |

Run `mokosh --query-help` for the full reference.

## MCP server

Always available in this project — configured in `.mcp.json`. **Prefer MCP tools over the CLI** for any dependency query. See `/mokosh` skill for the full tool reference.

Call order: `analyze` first (builds + caches graph), then any of: `get_dependencies`, `get_dependents`, `get_affected`, `propose_tags`, `propose_affected_tests`, `detect_features`, `query`, `find_unused`.

`query` defaults to `slim: true` — compact nodes with `importsFiles` (flat path list), export names, and meaningful tags only. Pass `slim: false` only when full edge metadata is needed.

## Build

```bash
npm run build      # compiles to dist/
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

## Release

Releases are cut from `main` via the **Release** GitHub Actions workflow (workflow_dispatch): you pick `patch`/`minor`/`major` or an exact version; CI regenerates `CHANGELOG.md` from conventional commits, tags `vX.Y.Z`, creates the GitHub Release, and publishes to npm. Commit messages must be conventional — enforced by commitlint (husky `commit-msg` hook). See `docs/releasing.md`.

## Before changing files

Run `/pre-update` — it calls `get_affected` to show blast radius before any edits.

## Adding a new language parser

1. Create `src/parser/lang/<lang>.ts` — implement `ParseResult parse(filePath, source)`.
2. Register it in `src/parser/registry.ts`.
3. Add the file extension to `DEFAULT_EXTENSIONS` in `src/const.ts` and to the `FileType` enum in `src/types/parse.ts`.
4. Add the extension to `src/parser/file-type.ts` extension → `FileType` mapping.

## Docs

`docs/` has deeper write-ups:
- `architecture.md` — overall design decisions
- `mcp.md` — MCP tool reference
- `query.md` — query DSL in depth
- `traversal.md` — graph traversal semantics
- `lock-files.md` — lock file parsing
- `releasing.md` — release process and commit conventions
- `adr-001-styles-parsing.md`, `adr-002-python-parsing.md` — ADRs for key parser decisions