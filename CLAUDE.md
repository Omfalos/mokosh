# mokosh — codebase guide

## What it is

A dependency-graph analysis tool. Parses source files, builds a directed import graph, and exposes it via CLI and MCP server. Two published outputs: a CLI binary and an MCP server.

> Published to npm as `@omfalos/mokosh`. For local development, build with `npm install && npm run build`.

## How it works (the pipeline)

```
Entry points
    │
    ▼
GraphBuilder.build()          ← src/graph/builder.ts
  │  Queue-pumped wavefront from entry points (not strict DFS — each round
  │    parses/resolves every queued file in parallel via Promise.all; newly
  │    discovered files join the next round). parseFile() optionally offloaded
  │    to a piscina worker pool — see docs/adr-010-parallel-parsing.md
  │  For each file:
  │    parseFile()             ← src/parser.ts → parser registry → lang parser
  │    resolveImports()        ← src/graph/resolver.ts
  │      Turns raw specifiers into absolute paths
  │      Recurses into each local dependency
  │    Reuses node if mtime+size unchanged (incremental build)
  │    Annotates external imports with lock-file versions
  │  After the wavefront drains: separate scans discover test files and doc
  │    files (.md/.mdx), which are never reachable via imports
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
  │  enrichDocDrift            Links markdown docs to referenced files; flags docs whose
  │                            referenced files committed more recently (commit-recency
  │                            heuristic, not a content diff)
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

Directory-level only — for a specific file's role, ask mokosh itself
(`get_module_responsibility` / `query`) rather than expecting this list to enumerate every file;
per-file lists here go stale the moment a file is added, split, or renamed.

```
src/
  index.ts / cli.ts / mcp.ts   entry points (see table above)
  const.ts, config.ts, types.ts, git.ts, coverage.ts   shared low-level helpers
  parser.ts           aggregates all language parsers
  graph.ts            thin re-export of src/graph/
  parse-worker.ts, duplication-worker.ts   piscina task handlers (parsing / tokenizing) run in worker threads
  watch-ignore.ts     shared fs.watch ignore pattern (MCP session cache + CLI --watch)

  types/              FileNode, ImportEdge, ExportedSymbol, CallEdge, StructuredTag, SerializedGraph, enums — split from the former src/types.ts
  exporters/          MermaidExporter / toMermaid()

  graph/              core engine: builder.ts (walks FS → Graph), model.ts (Graph class),
                      resolver.ts + lang-resolvers/ (specifier → path), enrichment.ts (post-build
                      passes), analyzer.ts, workspace/ + workspace-model.ts (monorepo), features/,
                      responsibility/, call-graph/, symbol.ts, type-graph.ts, api-surface.ts,
                      change-impact-cache.ts, queries.ts (shared CLI/MCP query shaping),
                      duplication/ (suffix-array based cross-language dup detection — see
                      docs/adr-012 through adr-015-duplicate-detection*.md), compare.ts +
                      worktree.ts + branch-graph-cache.ts (compare_branches: diffs the current
                      graph against another git ref via a temporary worktree, sha-cached to disk
                      — see docs/adr-016-branch-comparison.md)

  parser/             per-language parsers (lang/, one file per language), style/ (CSS/SCSS/Stylus
                      via real ASTs), complexity.ts + complexity/ (per-language complexity +
                      call-edge extraction — see docs/adr-011-go-python-call-edges.md), tagging/
                      (AST tag-collection strategies), registry.ts, classify.ts, lockfile.ts

  query/              parseQuery() + filterGraph() — the --query DSL engine (see below)
  tags/               proposeTagsFromDiff, applyTags, strategies/ (one per test framework:
                      cypress, playwright, vitest, jest, pytest, go, gherkin, + glob fallback)

  mcp/                server.ts, handlers.ts (one per MCP tool), tools.ts (JSON Schemas), cache.ts
  cli/                runner.ts (dispatch, --watch), args.ts, graph-loader.ts (disk cache),
                      commands/ (one file per flag, mirrors the MCP tools 1:1 where one exists —
                      run `mokosh --help` for the full flag list)
```

## Core data types

**`FileNode`** (`src/types/node.ts`) — one node per source file:
- `path` — project-relative path (the graph key)
- `type` — language (`typescript`, `python`, `css`, …)
- `category` — role: `logic | ui | test | config | barrel | type-only | other`
- `imports: ImportEdge[]` — outgoing edges; each edge has `toPath`, `rawSpecifier`, `symbols`, `isExternal`, `isWorkspace`
- `exports: ExportedSymbol[]` — named exports with optional doc/signature
- `tags: StructuredTag[]` — semantic labels (kind: `declaration | import | marker | comment | option-bag`)
- Optional enriched fields: `commitCount90d`, `lastAuthor`, `lastCommitAt`, `coveragePct`, `complexity`, `cognitiveComplexity`, `callEdges`, `avgExportUsage`, `maxExportUsage`, `documentedBy`, `staleFor`

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

Call order: `analyze` first (builds + caches graph), then any of: `get_dependencies`, `get_dependents`, `get_affected`, `propose_tags`, `propose_affected_tests`, `detect_features`, `query`, `find_unused`, `find_duplicates`.

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
- `adr-001-styles-parsing.md` through `adr-016-branch-comparison.md` — ADRs for key architecture/parser decisions