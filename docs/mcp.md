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

**Returns:** `{ nodeCount, categories, cycles }`

```json
{
  "nodeCount": 42,
  "categories": { "logic": 28, "test": 8, "barrel": 4, "config": 2 },
  "cycles": []
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

**Returns:** `{ file, dependencies: string[] }`

---

### `get_dependents`

One-hop incoming edges — files that directly import a given file.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |

**Returns:** `{ file, dependents: string[] }`

---

### `get_affected`

Full incoming traversal — every file whose behaviour could change if `file` changes. Use this before a refactor to understand blast radius.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `file` | `string` | yes | File path relative to `root` |
| `testsOnly` | `boolean` | no | Restrict results to test/spec files (default: `false`) |

**Returns:** `{ file, affected: string[], count: number }`

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
| `entryPoints` | `string[]` | yes | Entry points relative to `root` |

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

### `propose_tags`

Backward-traverses from each changed file to find affected test files, then returns their tags. Feature hub files (high out-degree) short-circuit the traversal and emit a `feature:<name>` tag to prevent tag explosion.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `changedFiles` | `string[]` | no | Changed files relative to `root`. Omit to read from `git diff --name-only` |
| `featureThreshold` | `number` | no | Min importers for a file to be treated as a hub (default: `5`) |

**Returns:** `{ changedFiles: string[], proposedTags: string[] }`

**Requires:** a prior `analyze` call for the same `root`.

---

### `propose_affected_tests`

Backward-traverses from each changed file and returns the **file paths** of affected test files, ready to pass directly to a test runner (e.g. `vitest`). Feature hubs act as traversal boundaries — tests reachable only through a hub are excluded.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `changedFiles` | `string[]` | no | Changed files relative to `root`. Omit to read from `git diff --name-only` |
| `featureThreshold` | `number` | no | Min importers for a file to be treated as a hub (default: `5`) |

**Returns:** `{ changedFiles: string[], affectedTests: string[], count: number }`

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

### `clear_cache`

Drop the cached dependency graph for a project root, forcing the next `analyze` call to rebuild from disk. Call this after editing source files mid-session — otherwise query tools will reason from stale data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the project root to invalidate |

**Returns:** `{ cleared: true }`

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
  tools.ts          TOOL_DEFINITIONS — JSON Schema for all 14 tools
  handlers.ts       One handler function per tool
  utils.ts          text() response helper
```