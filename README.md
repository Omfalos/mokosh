# Mokosh 🌊

> Available on npm as [`@omfalos/mokosh`](https://www.npmjs.com/package/@omfalos/mokosh).

Mokosh is a lightweight, AST-powered dependency graph generator for modern web and script projects. It extracts import maps from JavaScript, TypeScript, Python, Go, CSS, SCSS, Less, Stylus, CoffeeScript, LiveScript, Lua, and Gherkin files to help AI models and developers understand code relationships efficiently.

Designed for performance and RAG (Retrieval-Augmented Generation) workflows, Mokosh enables you to visualize your project structure, traverse dependencies, and even propose test tags based on code changes.

## Why Mokosh?

- **Runs entirely on your machine.** No accounts, no servers, no data sent anywhere. Your source code stays local at all times.
- **Works offline.** The graph is built from your filesystem — no network required during analysis.
- **Integrates in minutes via MCP.** Drop it into any AI assistant that supports the Model Context Protocol and start querying your codebase immediately.
- **Spans 10+ languages in one graph.** TypeScript, Python, Go, CSS, SCSS, Lua, Gherkin, and more — all in a single traversable dependency graph.
- **AI-ready output.** Slim query mode, token-efficient responses, and structured tags are designed to fit naturally into LLM context windows.
- **No vendor lock-in.** Open tool, open format. Run it in CI, in a local script, or as an MCP server — your choice.

## Features

- **Multi-Language Support**: Robust extraction from:
    - **JavaScript/TypeScript**: static `import`, dynamic `import()`, `require()`, and re-exports.
    - **Python**: all import forms (`import X`, `from X import Y`, relative `.`/`..` imports, star imports) via `@lezer/python` AST. Test files (`test_*.py`, `*_test.py`) and test frameworks (`pytest`, `unittest`) auto-detected.
    - **Go**: top-level declarations and `// @tag` markers via `@lezer/go` AST. All imports are treated as external (local package resolution requires `go.mod` context).
    - **CSS/SCSS/Less/Stylus**: tracks `@import` relationships.
    - **CoffeeScript/LiveScript/Lua/Gherkin**: AST-based parsing for dependencies and tags.
- **Graph Traversal**: Programmatically explore dependencies from any entry point with depth control.
- **Visual Diagrams**: Export your dependency graph to Mermaid.js format.
- **Lock File Integration**: Automatically extract dependency versions and tags from `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml`.
- **Unused File Detection**: Identify files in your project that are not imported by any entry point.
- **Cycle Detection**: Check for circular dependencies and use as a CI gate (`--check-cycles` exits non-zero if cycles are found).
- **Caching**: Serialize and deserialize the graph to save computation time.
- **Filtering & Token Saving**: Use `--query` to filter nodes and dependencies, significantly reducing the size of the output for AI models.
- **Test Tag Proposal**: Automatically identify affected Playwright/Cucumber test tags based on `git diff`.
- **Feature Hub Detection**: Identify architectural hub files (files with high out-degree — orchestrators and aggregators that import many internal modules) and surface them as `feature:<name>` tags. Prevents tag explosion when a widely-used utility changes.
- **Enriched Exports**: Named exports carry their JSDoc description, type signature, and lifecycle flags (`deprecated`, `internal`, `public`, `alpha`, `beta`) — giving AI models precise symbol-level context.
- **Call Edges**: Beyond imports, Mokosh traces cross-file function/method calls and stores them as `callEdges` on each node.
- **Tested-By Index**: Every logic/barrel file records which test files import it (`testedBy`), enabling instant "what tests cover this module?" queries.
- **Git Stats**: Optionally enrich each node with `commitCount90d` and `lastAuthor` (enabled via `gitStats: true` in config), enabling sorting by commit activity.

## Token Saving with Queries

When working with large codebases, providing the entire dependency graph to an AI model can exceed context limits or waste tokens. Use the `--query` flag to filter the output to only what's relevant:

- **Filter by language**: `--query "type:typescript"`
- **Filter by category**: `--query "category:ui"`
- **Filter by tag**: `--query "tag:core"`
- **Filter by documentation**: `--query "hasDocstring:false"` — find files missing a JSDoc description
- **Combine filters**: `--query "category:logic,tag:api"`

Example of a focused query:
```bash
npx @omfalos/mokosh --query "type:typescript,category:logic" src/index.ts
```

## Supported Languages & Tags

Mokosh automatically detects file types and uses the appropriate parser. You can also group files using `@tag <name>` in comments:

| Language | Extension | Tag Example |
| --- | --- | --- |
| JavaScript | `.js`, `.jsx` | `// @tag core` |
| TypeScript | `.ts`, `.tsx` | `// @tag models` |
| Python | `.py` | `# @tag auth` |
| Go | `.go` | `// @tag service` |
| CSS/SCSS/Less | `.css`, `.scss`, `.less` | N/A |
| Stylus | `.styl` | N/A |
| CoffeeScript | `.coffee` | `# @tag script` |
| LiveScript | `.ls` | `# @tag app` |
| Lua | `.lua` | `-- @tag config` |
| Gherkin | `.feature` | `@smoke` |

## Installation

Install from npm:

```bash
npm install @omfalos/mokosh
```

Or run it without installing via `npx`:

```bash
npx @omfalos/mokosh src/index.ts
```

To work on Mokosh itself, clone and build locally:

```bash
git clone https://github.com/Omfalos/mokosh.git
cd mokosh
npm install
npm run build
```

## Quick Start

### CLI Usage

Generate a dependency graph as JSON:
```bash
npx @omfalos/mokosh src/index.ts
```

Generate a Mermaid diagram:
```bash
npx @omfalos/mokosh --mermaid src/index.ts > graph.mmd
```

Propose test tags for changed files:
```bash
npx @omfalos/mokosh --propose-tags src/index.ts
```

Detect feature hub files (high out-degree orchestrators):
```bash
npx @omfalos/mokosh --detect-features src/index.ts
```

Find unused files:
```bash
npx @omfalos/mokosh --find-unused src/index.ts
```

Use caching to speed up subsequent runs:
```bash
npx @omfalos/mokosh --cache mokosh-cache/graph.json src/index.ts
```

> **Note:** Add `mokosh-cache/` to your `.gitignore` to avoid committing the cache directory.

Filter graph by category and tag:
```bash
npx @omfalos/mokosh --query "category:logic,tag:auth" src/index.ts
```

### Options

- `--cache [file]`: Path to cache file. If no file is provided, it defaults to `mokosh-cache/graph.json` in the project root.
- `--config <file>`: Path to a `mokosh.config.js` / `mokosh.config.json` file (overrides auto-discovery).
- `--root <dir>`: Set the project root directory (default: current directory).
- `--mermaid`: Output a Mermaid chart (`graph TD`) instead of JSON.
- `--propose-tags`: Use `git diff` to identify changed files and propose relevant test tags by traversing the dependency graph.
- `--plain`: Output tags as plain text (one per line) instead of JSON. Use with `--propose-tags`.
- `--affected-tests`: Like `--propose-tags` but outputs test file paths instead of tags — pipe directly into a test runner: `vitest $(mokosh --affected-tests)`.
- `--detect-features`: Output files with high out-degree (feature hubs — orchestrators/aggregators that import many internal modules), sorted by out-degree descending.
- `--feature-threshold <N>`: Minimum internal imports (out-degree) for a file to be a feature hub (default: `5`). Applies to `--detect-features`, `--propose-tags`, and `--affected-tests`.
- `--find-unused`: Scan the project for files that are not reachable from the specified entry points.
- `--exclude-tests`: Exclude test files from `--find-unused` output.
- `--check-cycles`: Check for circular dependencies; exits non-zero if any are found (CI gate).
- `--find-uncovered`: List non-test files whose line coverage is below the configured threshold (requires `coverageReportPath` in `mokosh.config.*`). Use `--feature-threshold` to override the default 80 % threshold.
- `--callers`: List files whose exported functions call into a given file. Requires `--file <path>`. More precise than `--find-unused` because it uses call edges rather than import edges.
- `--file <path>`: Target file for `--callers`.
- `--query <query>`: Filter the output graph using a query string. Supported keys: `path`, `type`, `category`, `tag`, `external`, `importsFile`, `importedBy`, `minImports`, `maxImports`, `minSize`, `maxSize`, `hasDocstring`, `sort`, `limit`. Example: `category:logic,hasDocstring:false`.
- `--query-help`: Print the full query filter reference and examples.
- `--silent`: Suppress progress output on stderr.
- `--help`: Show usage information.

### Programmatic API

```typescript
import { createImportMap } from 'mokosh';

const rootDir = process.cwd();
const entryPoints = ['src/main.ts'];

const graph = createImportMap(rootDir, entryPoints);

// Traverse the graph
graph.traverse('src/main.ts', (node, depth) => {
  console.log(`${'  '.repeat(depth)} ${node.path}`);
});

// Export to Mermaid
console.log(graph.toMermaid());
```

## Documentation

For detailed information on each process, check the following guides:

### Guides
- [Architecture Overview](./docs/architecture.md)
- [Product Requirements Document (PRD)](./docs/prd.md)
- [Usage Guide](./docs/usage.md)
- [Query Language Guide](./docs/query.md)
- [Graph Traversal](./docs/traversal.md)
- [Test Tag Proposal](./docs/test-tags.md)
- [Lock File Analysis](./docs/lock-files.md)
- [MCP Server](./docs/mcp.md)
- [Monorepo Support](./docs/monorepo.md)
- [Roadmap](./docs/roadmap.md)

### Architecture Decision Records
- [ADR-001: AST Libraries for Style Parsers](./docs/adr-001-styles-parsing.md)
- [ADR-002: Python Parsing with @lezer/python](./docs/adr-002-python-parsing.md)
- [ADR-003: Call-Edge Graph — Function-Level Dependency Layer](./docs/adr-003-call-edge-graph.md)
- [ADR-004: Type Graph — Type-Level Dependency Layer](./docs/adr-004-type-graph.md)
- [ADR-005: Feature Graph — Domain Clustering by Hub Detection](./docs/adr-005-feature-graph.md)
- [ADR-006: Responsibility Graph — Semantic Role Assignment](./docs/adr-006-responsibility-graph.md)
