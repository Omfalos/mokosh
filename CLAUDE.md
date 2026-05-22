# mokosh — codebase guide

## What it is

A dependency-graph analysis tool. Parses source files, builds a directed import graph, and exposes it via CLI and MCP server. Two published outputs: a CLI binary and an MCP server.

> **Not yet published to npm.** Build locally with `npm install && npm run build`.

## Entry points

| Entry | Purpose |
|-------|---------|
| `src/index.ts` | Public library API (used by CLI and MCP) |
| `src/cli.ts` → `src/cli/runner.ts` | CLI binary |
| `src/mcp.ts` → `src/mcp/server.ts` | MCP server |

## Key architectural hubs (high blast radius)

- **`src/types.ts`** — imported by almost every file; changing any type here touches the whole codebase
- **`src/index.ts`** — re-exports everything used by CLI and MCP; changes here affect both consumers
- **`src/parser.ts`** — aggregates all language parsers; changes affect the graph builder

## Module map

```
src/
  index.ts          public API
  types.ts          shared types (FileNode, SerializedGraph, etc.)
  config.ts         mokosh.config.* loading
  git.ts            git diff helpers
  graph.ts          thin re-export of src/graph/
  parser.ts         aggregates all language parsers
  query/            graph filter DSL (parse + filter)
  tags/             tag proposer and identifier
  graph/
    builder.ts      walks the FS, calls parsers, builds the Graph
    model.ts        Graph class (traverse, findCycles, serialize)
    analyzer.ts     in-degree / out-degree analysis
    enrichment.ts   adds metadata to nodes post-build
    exporter.ts     Mermaid serialization
    features/       feature hub detection
    resolver.ts     import path resolution
  parser/
    lang/
      typescript.ts TypeScript/JavaScript via tsc
      python.ts     Python via @lezer/python (pure-JS LR parser — see docs/adr-002-python-parsing.md)
      coffee.ts     CoffeeScript
      gherkin.ts    Gherkin/Cucumber
      ls.ts         LiveScript
      lua.ts        Lua
    style/          CSS/SCSS/Stylus
    classify.ts     file category classification (logic/barrel/type-only/test)
    file-type.ts    extension → language mapping
    lockfile.ts     package-lock.json / yarn.lock / pnpm-lock.yaml parser
    registry.ts     parser registry
    tagging/        AST tag-collection strategies (declaration names, @markers, comments, option-bags)
    types.ts        parser-local types
  mcp/
    server.ts       MCP server setup
    handlers.ts     one handler per MCP tool
    tools.ts        JSON Schema definitions for all MCP tools
    cache.ts        session graph cache
    utils.ts        response helpers
  cli/
    runner.ts       command dispatch
    args.ts         CLI arg parsing
    config.ts       config loading for CLI
    graph-loader.ts graph build + cache for CLI
    help.ts         --help text
    commands/       one file per CLI command
```

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

## Before changing files

Run `/pre-update` — it calls `get_affected` to show blast radius before any edits.