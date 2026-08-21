# Mokosh 🌊

Mokosh is an AST-powered dependency-graph analysis tool for polyglot codebases. It parses source
files, builds a directed import graph, and exposes it through a CLI and an MCP server — so both
humans and AI assistants can query dependencies, blast radius, complexity, duplication, coverage,
and doc-drift from one graph instead of grepping around.

## Why Mokosh?

- **Runs entirely on your machine.** No accounts, no servers, no data sent anywhere.
- **Works offline.** The graph is built from your filesystem — no network required during analysis.
- **Spans 15+ languages in one graph.** TypeScript, JavaScript, Python, Go, CSS/SCSS/Less/Stylus,
  CoffeeScript, LiveScript, Lua, Gherkin, and Markdown/MDX — all in a single traversable graph.
- **AI-ready output.** Slim query mode, token-efficient responses, and structured tags are
  designed to fit naturally into LLM context windows.
- **Integrates in minutes via MCP.** Drop it into any AI assistant that supports the Model
  Context Protocol and start querying your codebase immediately.
- **No vendor lock-in.** Open tool, open format. Run it in CI, in a local script, or as an MCP
  server — your choice.

## What it can tell you

- **Dependency graph traversal** — dependencies, dependents, and full blast-radius (`get_affected`)
  from any file, with call-edge precision (not just imports) for TS/JS/Go/Python.
- **Cycle detection**, usable as a CI gate.
- **Unused-file detection** — files unreachable from any entry point.
- **Duplicate-code detection** — cross-language, suffix-array based, structural for CSS.
- **Complexity & risk hotspots** — McCabe cyclomatic + cognitive complexity per function, and a
  combined complexity × low-coverage × churn signal (`find_risk_hotspots`).
- **Doc-drift detection** — flags markdown docs whose referenced files changed more recently than
  the doc itself.
- **Test-tag proposal** — infers affected test tags/files from `git diff`, and can write `@tag`
  annotations back into test files (`apply_tags`).
- **Type graph, API surface, module responsibility, feature-hub detection** — higher-level views
  built on top of the same graph.
- **Monorepo support** — auto-detects Turborepo/Nx/pnpm/Yarn/npm workspaces and gives you
  per-package graphs plus cross-package blast radius.

Every capability above is available identically from the CLI and the MCP server — see
[docs/mcp.md](./docs/mcp.md) for the full MCP tool reference and [docs/usage.md](./docs/usage.md)
for the full CLI reference.

## Supported languages

| Language | Extensions | `@tag` marker |
| --- | --- | --- |
| TypeScript / JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | `// @tag core` |
| Python | `.py` | `# @tag auth` |
| Go | `.go` | `// @tag service` |
| CSS / SCSS / Sass / Less | `.css`, `.scss`, `.sass`, `.less` | N/A |
| Stylus | `.styl` | N/A |
| CoffeeScript | `.coffee` | `# @tag script` |
| LiveScript | `.ls` | `# @tag app` |
| Lua | `.lua` | `-- @tag config` |
| Gherkin / Cucumber | `.feature` | `@smoke` |
| Markdown / MDX | `.md`, `.mdx` | N/A (used for doc-drift linking) |

## Install & build

```bash
git clone https://github.com/Omfalos/mokosh.git
cd mokosh
npm install
npm run build
```

Mokosh is also published as [`@omfalos/mokosh`](https://www.npmjs.com/package/@omfalos/mokosh) —
`npm install @omfalos/mokosh`, or run it without installing via `npx @omfalos/mokosh <entry-point>`.

## Quick start

### AI assistant setup (recommended first step)

Scaffold a Claude Code skill and slash command that teach your AI assistant how to drive Mokosh —
via MCP if it's configured, falling back to the CLI otherwise:

```bash
mokosh --init-skill
```

This writes `.claude/skills/mokosh/SKILL.md` (auto-invoked) and `.claude/commands/mokosh.md`
(explicit `/mokosh`) into your project. Existing files are left untouched — pass `--force` to
overwrite.

### MCP server

Point your MCP client at `dist/mcp.js` (see `.mcp.json` in this repo for a working example).
Call `analyze` once to build and cache the graph, then call any other tool — `get_dependencies`,
`get_affected`, `find_unused`, `find_duplicates`, `find_risk_hotspots`, `query`, and 15+ more.
Full tool-by-tool reference: [docs/mcp.md](./docs/mcp.md).

### CLI

```bash
# Dependency graph as JSON
mokosh src/index.ts

# Mermaid diagram
mokosh --mermaid src/index.ts > graph.mmd

# Filter the graph to save tokens
mokosh --query "category:logic,hasDocstring:false" src/index.ts

# Blast radius / affected tests / unused files / cycles
mokosh --affected --file src/auth/session.ts src/index.ts
mokosh --affected-tests src/index.ts
mokosh --find-unused src/index.ts
mokosh --check-cycles src/index.ts

# Watch mode — re-runs on file changes
mokosh --watch --query "category:logic" src/index.ts
```

Run `mokosh --help` for the full flag reference, `mokosh --query-help` for the query DSL, or see
[docs/usage.md](./docs/usage.md) for a guided walkthrough of every command.

### Programmatic API

```typescript
import { createImportMap } from "@omfalos/mokosh";

const graph = createImportMap(process.cwd(), ["src/index.ts"]);

graph.traverse("src/index.ts", (node, depth) => {
  console.log(`${"  ".repeat(depth)} ${node.path}`);
});

console.log(graph.toMermaid());
```

## Configuration

Mokosh auto-discovers `mokosh.config.json` / `.js` / `.cjs` in the project root for both the CLI
and the MCP server — scaffold a commented starter with `mokosh --init-config`.

> The MCP server only loads `mokosh.config.json` (JS execution is disabled there for safety). If
> you want the MCP server to pick up your config, use a `.json` file rather than `.js`/`.cjs`.

Commonly-used fields — see [docs/usage.md](./docs/usage.md#configuration-file) for the complete
list, factory-function configs, and programmatic config-loading:

| Field | Type | Description |
| --- | --- | --- |
| `entryPoints` | `string[]` | Default entry points when none passed on the CLI |
| `ignoreDirs` / `extensions` | `string[]` | Extra dirs/extensions, merged with the built-in defaults |
| `pathAliases` | `Record<string, string[]>` | Explicit import-alias map (tsconfig `paths` shape); takes precedence over `tsconfig.json` |
| `gitStats` | `boolean` | Enables `commitCount90d` / `lastAuthor` enrichment (off by default) |
| `coverageReportPath` / `coverageThreshold` | `string` / `number` | Istanbul coverage summary + threshold for `find_uncovered` / `find_risk_hotspots` |
| `tagApplier` | `{ framework?, frameworkOverrides? }` | Test-tag output format for `apply_tags` — see [ADR-008](./docs/adr-008-tag-applier-strategies.md) |
| `parallelParsing` | `boolean \| { minFiles?, maxThreads? }` | Worker-pool parsing threshold — see [ADR-010](./docs/adr-010-parallel-parsing.md) |

## Documentation

### Guides
- [Architecture Overview](./docs/architecture.md)
- [Usage Guide](./docs/usage.md)
- [Query Language Guide](./docs/query.md)
- [Graph Traversal](./docs/traversal.md)
- [Test Tag Proposal](./docs/test-tags.md)
- [Lock File Analysis](./docs/lock-files.md)
- [MCP Server](./docs/mcp.md)
- [Monorepo Support](./docs/monorepo.md)
- [Releasing](./docs/releasing.md)

### Architecture Decision Records
- [ADR-001: AST Libraries for Style Parsers](./docs/adr-001-styles-parsing.md)
- [ADR-002: Python Parsing with @lezer/python](./docs/adr-002-python-parsing.md)
- [ADR-003: Call-Edge Graph — Function-Level Dependency Layer](./docs/adr-003-call-edge-graph.md)
- [ADR-004: Type Graph — Type-Level Dependency Layer](./docs/adr-004-type-graph.md)
- [ADR-005: Feature Graph — Domain Clustering by Hub Detection](./docs/adr-005-feature-graph.md)
- [ADR-006: Responsibility Graph — Semantic Role Assignment](./docs/adr-006-responsibility-graph.md)
- [ADR-007: Go Import Resolution](./docs/adr-007-go-resolution.md)
- [ADR-008: Tag Applier Strategy Architecture](./docs/adr-008-tag-applier-strategies.md)
- [ADR-009: AST Library for Markdown Parsing](./docs/adr-009-markdown-parsing.md)
- [ADR-010: Worker-Pool Parallel Parsing](./docs/adr-010-parallel-parsing.md)
- [ADR-011: Extending Complexity and Call Edges to Go and Python](./docs/adr-011-go-python-call-edges.md)
- [ADR-012: Duplicate Detection](./docs/adr-012-duplicate-detection.md)
- [ADR-013: Duplicate Detection Noise Reduction](./docs/adr-013-duplicate-detection-noise-reduction.md)
- [ADR-014: Duplicate Detection at Scale](./docs/adr-014-duplicate-detection-scale.md)
- [ADR-015: Suffix-Array Duplicate Detection](./docs/adr-015-suffix-array-duplicate-detection.md)
