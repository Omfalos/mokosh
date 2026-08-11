# MCP Server

Mokosh ships an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes the dependency graph as structured tools. Any MCP-compatible host (Claude Desktop, Cursor, a custom agent) can call these tools directly instead of spawning a CLI subprocess and parsing stdout.

## Running the server

```bash
# via npx (no install required)
npx mokosh-mcp

# or, after a local install
mokosh-mcp
```

The server communicates over **stdio** using the MCP JSON-RPC protocol. Add it to your MCP host config exactly like any other stdio server:

```json
{
  "mcpServers": {
    "mokosh": {
      "command": "npx",
      "args": ["mokosh-mcp"]
    }
  }
}
```

## Configuration

The server auto-loads a `mokosh.config.json` from the project root (the `rootDir`/`root` argument passed on the first `analyze` call) — no extra step needed. Only `mokosh.config.json` is honored here; `.js`/`.cjs` configs are skipped (`allowJs: false`) to avoid executing arbitrary code from an AI-driven surface. Run `npx @omfalos/mokosh --init-config` to scaffold a starter `mokosh.config.js`, then convert it to `mokosh.config.json` (stripping the `//` comments, since JSON doesn't support them) if you want the MCP server to pick it up. See the [Usage Guide](./usage.md#configuration-file) for the full field reference.

## Wiring up an AI assistant fast

Run `npx @omfalos/mokosh --init-skill` to scaffold a Claude Code skill (`.claude/skills/mokosh/SKILL.md`) and slash command (`.claude/commands/mokosh.md`) into your project. Both teach the assistant to prefer these MCP tools when available and fall back to the CLI otherwise — no need to hand-write tool-usage instructions. Existing files are left untouched unless `--force` is passed.

## Session model

The server holds an **in-process graph cache** keyed by project root. This means:

1. Call `analyze` once per project root to build and cache the graph.
2. All subsequent tools (`get_dependencies`, `get_dependents`, `get_affected`, `propose_tags`, etc.) reuse the cached graph — no disk re-parsing.
3. Calling `analyze` again incrementally rebuilds: only files whose `mtime` or `size` changed are re-parsed.
4. Call `clear_cache` to force a full rebuild (e.g., after editing source files mid-session).

`find_unused`, `detect_features`, and `query` can optionally build their own graph if `entryPoints` are supplied, bypassing the cache requirement.

**Monorepo**: pass `entryPoints: []` to `analyze` to trigger workspace auto-detection. Then use `get_workspace_packages` and `get_workspace_affected` instead of the single-package tools. See [Monorepo Support](./monorepo.md).

---

## Tools

### `analyze`

Build the dependency graph from one or more entry points and cache it for the session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the project root (or monorepo root) |
| `entryPoints` | `string[]` | yes | Entry point files relative to `root`. Pass `[]` to trigger monorepo auto-detection. |

**Returns:** `{ nodeCount, categories, cycles, languageCoverage }` (single-graph builds only — the
monorepo auto-detection branch doesn't include `languageCoverage` yet).

`languageCoverage` is one entry per language actually present in the repo, reporting what mokosh
tracks for it: `exportsTracked` (can any tool find the file that defines a symbol?),
`importSymbolsTracked` (can tools tell which specific named symbols an importer uses?), and
`callEdgesTracked` (are function-level call edges available, e.g. for `get_call_graph`/`find_symbol`
precision `"call"`). This is the authoritative, always-current version of the capability notes
repeated in tool descriptions like `find_symbol`'s — check it once after `analyze` instead of
discovering degraded precision by trial and error.

```json
{
  "nodeCount": 42,
  "categories": { "logic": 28, "test": 8, "barrel": 4, "config": 2 },
  "cycles": [],
  "languageCoverage": [
    { "type": "typescript", "fileCount": 38, "exportsTracked": true, "importSymbolsTracked": true, "callEdgesTracked": true },
    { "type": "python", "fileCount": 4, "exportsTracked": true, "importSymbolsTracked": true, "callEdgesTracked": false }
  ]
}
```

---

### `get_dependencies`

Outgoing traversal — files that a given file imports.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |
| `depth` | `number` | no | Max traversal depth (default: `1` = immediate imports only) |
| `withMeta` | `boolean` | no | Include `category` and `exports` per result (default: `false`) |

**Returns:** `{ file, dependencies: { path, symbols? }[] }`. With `withMeta: true`, each entry is `{ path, symbols?, category, exports }`.

---

### `get_dependents`

One-hop incoming edges — files that directly import a given file.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |
| `withMeta` | `boolean` | no | Include `category` and `exports` per result (default: `false`) |

**Returns:** `{ file, dependents: { path, symbols? }[] }`. With `withMeta: true`, each entry is `{ path, symbols?, category, exports }`.

---

### `get_affected`

Full incoming traversal — every file whose behaviour could change if `file` changes. Use this before a refactor to understand blast radius.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |
| `testsOnly` | `boolean` | no | Restrict results to test/spec files (default: `false`) |
| `cached` | `boolean` | no | Use a pre-computed O(1) impact-cache lookup instead of graph traversal. Built lazily on first use and reused for the session (default: `false`) |
| `changedSymbols` | `string[]` | no | Restrict blast-radius to files that import at least one of these symbols. Omit to treat the whole file as changed |
| `withMeta` | `boolean` | no | Return each affected file as `{ path, category, exports }` instead of a bare path string (default: `false`) |

**Returns:** `{ file, affected: string[], count: number }`. With `withMeta: true`, `affected` is `{ path, category, exports }[]` instead of bare strings.

---

### `get_callers`

Files whose exported functions **call into** a given file (call-graph dependents). More precise than `get_affected`: only files with actual runtime call edges, not just import edges.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |
| `depth` | `number` | no | Max traversal depth (default: `1`) |
| `withEdgeDetail` | `boolean` | no | Include `from`/`to` function names per edge (default: `false`) |

**Returns:** `{ file, callers: string[], count: number }` (or with edge detail: `{ callers: Array<{ file, edges: CallEdge[] }> }`)

**Requires:** a prior `analyze` call for the same `root`.

---

### `find_unused`

Scans the project directory and compares against the reachable graph. Returns files that exist on disk but are not imported from any entry point.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | no | Entry points relative to `root`. Omit to reuse the cached graph from a prior `analyze` call instead of rebuilding. |

**Returns:** `{ unusedFiles: string[], count: number }`

---

### `find_uncovered`

Find non-test files whose line coverage is below a threshold. Requires a prior `analyze` call and `coverageReportPath` set in `mokosh.config`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `coverageThreshold` | `number` | no | Line coverage % below which a file is considered uncovered. Overrides the config value (default: `80`). |

**Returns:** `{ threshold, uncovered: Array<{ file, coveragePct }>, count: number }`

**Requires:** a prior `analyze` call for the same `root`.

---

### `list_tags`

Lists every distinct tag name present in the graph, with how many nodes carry it. Call this before querying with `tag:<name>` to avoid a speculative filter silently returning zero results. Includes all tag kinds — a superset of what `query`'s `slim` mode keeps (`slim` only retains `comment-marker` and `import` tags).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |

**Returns:** `{ tags: Array<{ name, count }>, count: number }`, sorted by count descending.

**Requires:** a prior `analyze` call for the same `root`.

---

### `find_complex_functions`

Scan every file's per-function complexity breakdown and return functions/methods at or above a threshold, sorted worst-first. Populated for TypeScript/JavaScript, Go, and Python (see [ADR-011](./adr-011-go-python-call-edges.md)).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `metric` | `"cognitiveComplexity" \| "complexity"` | no | Which score to threshold/sort on (default: `cognitiveComplexity`) |
| `threshold` | `number` | no | Minimum score to include (default: `10`) |
| `limit` | `number` | no | Max results to return, worst-first (default: `20`) |

**Returns:** `{ metric, threshold, functions: Array<{ file, name, line, complexity, cognitiveComplexity }>, count: number }`

**Requires:** a prior `analyze` call for the same `root`.

---

### `find_duplicates`

Find duplicated code blocks across the project, largest-first. Two matching strategies, picked per file by language (see [ADR-013](./adr-013-duplicate-detection-noise-reduction.md)):

- **CSS/SCSS/Less** — compared *structurally* by rule body, reusing the same PostCSS AST the graph builder already parses: two rules match when they have the same literal, ordered `property: value` declarations, independent of selector name. A rule that merely shares declaration *shape* with another (`display: flex` vs `display: block`) never matches, since comparison is on the actual content, not a normalized token placeholder.
- **Everything else** — TypeScript/JavaScript, Python, Go, CoffeeScript, LiveScript, Lua, Gherkin, Markdown, and Stylus (which has no shared PostCSS AST here) — runs the original token-based shingle pipeline (see [ADR-012](./adr-012-duplicate-detection.md)): comments are stripped, identifiers — and by default literals — are normalized to placeholders so renamed-variable copies still match, then a sliding token window is hashed and chain-merged. These files are further partitioned into language families (`style` for Stylus, `code` for the rest) so matching never crosses that boundary. Pair-matches that share an exact occurrence are then merged into one group, so a block repeated N times is reported once, with N occurrences, instead of once per pair — and blocks that are mostly object/array-literal structural punctuation (e.g. schema/object-literal boilerplate) rather than substantive shared logic are gated out via `maxPunctuationRatio`.

Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) and files under an ignored directory are always excluded, even if the graph itself contains them — `graph.nodes` isn't reliably ignore-rule-filtered for files reached via a resolved reference rather than the initial scan (e.g. a Markdown doc's code-span mention of a build artifact).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `minLines` | `number` | no | Minimum duplicated block size in lines to report (default: `6`) |
| `ignoreLiterals` | `boolean` | no | Normalize string/number literals too, not just identifiers, so only structural shape drives a match (default: `true`). Set `false` for stricter, exact-text-only matching |
| `maxPunctuationRatio` | `number` | no | Maximum fraction of a token-shingled block's window that may be object/array-literal structural punctuation (`{ } : , [ ]`) (default: `0.5`). Filters out blocks that are mostly schema/object-literal shape instead of substantive shared logic. Doesn't apply to the CSS/Less/SCSS structural comparator. Set `1` to disable |
| `maxBucketSize` | `number` | no | Skip a hash bucket's pairwise comparison once it holds more than this many matching locations (default: `400`). Bounds worst-case scan time on large repos where a single pathologically common token window would otherwise blow up quadratically — see [ADR-014](./adr-014-duplicate-detection-scale.md). Set a very large number to disable |
| `ignoreDirs` | `string[]` | no | Directory names to exclude, matched against any path segment (default: `DEFAULT_IGNORE_DIRS` merged with this root's configured `ignoreDirs`, if any). Pass `[]` to disable |
| `limit` | `number` | no | Max duplicate blocks to return, largest-first (default: `50`) |

On large repos, tokenizing is offloaded to a `piscina` worker pool once the candidate file count reaches 20 (same pattern and threshold as `GraphBuilder`'s parse pool, [ADR-010](./adr-010-parallel-parsing.md)) — see [ADR-014](./adr-014-duplicate-detection-scale.md).

**Returns:** `{ minLines, groups: Array<{ occurrences: Array<{ file, startLine, endLine }>, lines, tokens, family: "style" | "code" }>, count: number, skippedBuckets: number }`. Each group has two or more occurrences — every block that pairwise chain-matches another is clustered into one group, so a block duplicated across three files is reported as one three-occurrence group, not three pairs. A non-zero `skippedBuckets` means some pathologically common token windows were skipped for scan-time safety (see `maxBucketSize`), so results may under-report unusually widespread duplication.

**Requires:** a prior `analyze` call for the same `root`.

---

### `propose_tags`

Backward-traverses from each changed file to find affected test files. Feature hub files (high out-degree) short-circuit the traversal and emit a `feature:<name>` tag to prevent tag explosion.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `changedFiles` | `string[]` | no | Changed files relative to `root`. Omit to read from `git diff --name-only` |
| `featureThreshold` | `number` | no | Min importers for a file to be treated as a hub (default: `5`) |
| `format` | `"tags" \| "paths"` | no | `"tags"` (default) returns test tag names for CI filtering; `"paths"` returns test file paths, ready to pipe directly to a test runner (e.g. `vitest`) |

**Returns:** `{ changedFiles: string[], proposedTags: string[] }` (format: `tags`) or `{ changedFiles: string[], affectedTests: string[], count: number }` (format: `paths`)

**Requires:** a prior `analyze` call for the same `root`.

---

### `detect_features`

Identifies feature hub files — source files that import many other internal modules (orchestrators/aggregators). Returns them sorted by import count descending.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | no | Build a fresh graph from these entry points. Omit to reuse the cached graph |
| `featureThreshold` | `number` | no | Min internal imports a file must have to qualify (default: `5`) |

**Returns:** `{ features: Array<{ path, inDegree, tag }>, count: number }`

---

### `query`

Filters the graph by category, tag, path, coverage, complexity, or any other node field. Returns matching nodes as JSON or as a Mermaid diagram.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `filter` | `string` | yes | Query string e.g. `category:logic` or `category:logic,tag:auth` |
| `entryPoints` | `string[]` | no | Entry points to build the graph from. Omit to reuse the cached graph |
| `mermaid` | `boolean` | no | Return a `graph TD` Mermaid string instead of JSON (default: `false`) |
| `slim` | `boolean` | no | **Compact response mode (default: `true`).** Returns `importsFiles` (flat path list), export names, and meaningful tags only — no edge objects, no mtime/size. Pass `false` only when full edge metadata is needed. |

**Returns:** filtered `SerializedGraph` JSON (or Mermaid string).

Additional filter keys beyond the [Query Language Guide](./query.md) base set:

| Key | Example |
|-----|---------|
| `minCoverage:<pct>` | `minCoverage:80` |
| `maxCoverage:<pct>` | `maxCoverage:50` |
| `minExportUsage:<ratio>` | `minExportUsage:0.5` |
| `maxExportUsage:<ratio>` | `maxExportUsage:0.2` |
| `sort:exportUsage` | sort by `avgExportUsage` |

See the [Query Language Guide](./query.md) for the full syntax.

---

### `get_workspace_packages`

List all workspace packages detected in a monorepo, with their node counts and inter-package dependencies.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the monorepo root |

**Returns:** `{ packages: Array<{ name, relativeRoot, nodeCount, dependsOn: string[] }>, count: number }`

**Requires:** a prior `analyze` call with `entryPoints: []` on a monorepo root.

---

### `get_workspace_affected`

Cross-package blast-radius analysis. Returns every file that could be affected if a given file changes, annotated with the package it belongs to.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the monorepo root |
| `file` | `string` | yes | Monorepo-root-relative path of the changed file (e.g. `packages/shared/src/utils.ts`) |

**Returns:** `{ file, affected: Array<{ file: string, package: string }>, count: number }`

**Requires:** a prior `analyze` call with `entryPoints: []` on a monorepo root.

---

### `get_type_graph`

Type-level relationships for the project. Without a type name, returns an inventory of all interfaces, classes, enums, and type aliases with their file and kind. With a type name, returns which files import that type (`usedByFiles`) and which types the defining file imports (`uses`). TypeScript/JavaScript only.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `type` | `string` | no | Exact exported name of the type to look up (e.g. `FileNode`). Omit for the full type inventory |

**Requires:** a prior `analyze` call for the same `root`.

---

### `get_module_responsibility`

What each file is responsible for: its semantic role, JSDoc description (when present), exported symbol names, and which feature hub it belongs to.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `paths` | `string[]` | no | Project-relative file paths to include. Omit to return all files |
| `minOutDegree` | `number` | no | Min imports for a file to qualify as a feature hub (default: `5`) |

**Requires:** a prior `analyze` call for the same `root`.

---

### `get_feature_graph`

Groups files by domain: returns which files each feature hub (high-import orchestrator) transitively owns. Each file is assigned to the most specific hub that can reach it (lowest out-degree wins). Use this instead of a full `query` when answering "what files are in the X feature/module?" — typically 85-95% fewer tokens than a full graph query.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `minOutDegree` | `number` | no | Minimum internal imports a file must have to qualify as a feature hub (default: `5`) |

**Requires:** a prior `analyze` call for the same `root`.

---

### `get_call_graph`

Look up callers and callees for a named function. Returns the file that defines the function, all files/functions that call it, and all files/functions it calls. Always requires a function name — never returns the full call graph unfiltered. Call edges are populated for TypeScript/JavaScript, Go, and Python files (see [ADR-011](./adr-011-go-python-call-edges.md) for per-language coverage differences).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `function` | `string` | yes | Exact name of the function to look up (e.g. `parseFile`) |

**Requires:** a prior `analyze` call for the same `root`.

---

### `find_symbol`

Find every file that exports a symbol by exact name, with the best available usage info per
match. Precision depends on what the defining file's language parser tracks:

| Precision | Languages | What `callers`/`importers` means |
|---|---|---|
| `call` | TypeScript/JavaScript, Go, Python | Function-level callers via call edges — coverage differs per language, see [ADR-011](./adr-011-go-python-call-edges.md) |
| `file-level` | Lua, CoffeeScript, SCSS/Less, and everything else with populated exports | Whole-file dependents — an importer might not use this specific export |

Files whose parser never populates `exports` at all (CoffeeScript, LiveScript, Lua, Gherkin,
Markdown, CSS/SCSS/Stylus) never produce a match — a name that only exists in one of those files
returns an empty result, indistinguishable from a typo.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `name` | `string` | yes | Exact export name to look up (e.g. `parseFile`) |

**Requires:** a prior `analyze` call for the same `root`.

---

### `get_api_surface`

Builds the API surface report for a project. Expands `export *` chains so every symbol accessible to consumers is listed (not just those directly declared in the entry file). Each export is resolved to its defining file and tagged with a kind (`function`/`class`/`interface`/`type`/`enum`/`const`). The graph is partitioned into `internalFiles` (implementation reachable from entry points), `unreachableFromEntry` (non-test files not reachable from any entry point — may be separate consumers like CLI/MCP, config, or dead code), and `testFiles` (test suite). Supports multiple public entry points for libraries with sub-path exports.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | no | Project-relative paths of public entry points (e.g. `['src/index.ts', 'src/utils.ts']`). Omit to auto-detect from `package.json` `exports`/`main`/`module` fields |

**Requires:** a prior `analyze` call for the same `root`.

---

### `clear_cache`

Drop the cached dependency graph for a project root, forcing the next `analyze` call to rebuild from disk. Call this after editing source files mid-session — otherwise query tools will reason from stale data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the project root to invalidate |

**Returns:** `{ cleared: true }`

---

### `apply_tags`

Writes `@tag` annotations into test file source code based on the dependency graph. Tags of kind `import` (filename-derived) and `comment-marker` (domain semantic, propagated from source files) are written as an idempotent block; re-running replaces the block in place. Tags already present in the file are excluded to avoid duplication. Supports TypeScript/JavaScript (`// <mokosh-tags>` block with `// @tag` lines) and Gherkin `.feature` files (`# <mokosh-tags>` block with `@tagname` lines). See [ADR-008](./adr-008-tag-applier-strategies.md).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `dryRun` | `boolean` | no | When `true`, computes which files would change but does not write to disk (default: `false`) |

**Requires:** a prior `analyze` call for the same `root`.

---

## Programmatic usage

```typescript
import { createMcpServer } from 'mokosh';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createMcpServer();
await server.connect(new StdioServerTransport());
```

For testing, use `InMemoryTransport` to wire a client and server together without a real process boundary:

```typescript
import { createMcpServer } from 'mokosh';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const server = createMcpServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'my-client', version: '1.0.0' }, { capabilities: {} });

await server.connect(serverTransport);
await client.connect(clientTransport);

const result = await client.callTool({
  name: 'analyze',
  arguments: { root: '/path/to/project', entryPoints: ['src/index.ts'] },
});
```

## Source layout

```
src/mcp.ts          Entry point — connects server to StdioServerTransport
src/mcp/
  server.ts         createMcpServer() factory — wires cache, tools, handlers
  cache.ts          GraphCache — in-session graph store with incremental rebuild
  tools.ts          TOOL_DEFINITIONS — JSON Schema for all 20 tools
  handlers.ts       One handler function per tool
  utils.ts          text() response helper
```