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
2. All subsequent tools (`get_dependencies`, `get_dependents`, `get_affected`, `propose_tags`) reuse the cached graph — no disk re-parsing.
3. Calling `analyze` again incrementally rebuilds: only files whose `mtime` or `size` changed are re-parsed.

`find_unused`, `detect_features`, and `query` can optionally build their own graph if `entryPoints` are supplied, bypassing the cache requirement.

## Tools

### `analyze`

Build the dependency graph from one or more entry points and cache it for the session.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | Absolute path to the project root |
| `entryPoints` | `string[]` | yes | Entry point files relative to `root` |

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
| `root` | `string` | yes | Absolute path to the project root |
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

### `find_unused`

Scans the project directory and compares against the reachable graph. Returns files that exist on disk but are not imported from any entry point.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | yes | Entry points relative to `root` |

**Returns:** `{ unusedFiles: string[], count: number }`

---

### `propose_tags`

Backward-traverses from each changed file to find affected test files, then returns their tags. Feature hub files (high in-degree) short-circuit the traversal and emit a `feature:<name>` tag to prevent tag explosion.

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

Identifies feature hub files — source files imported by many others. Returns them sorted by in-degree descending.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | no | Build a fresh graph from these entry points. Omit to reuse the cached graph |
| `featureThreshold` | `number` | no | Min importers to qualify as a hub (default: `5`) |

**Returns:** `{ features: Array<{ path, inDegree, tag }>, count: number }`

---

### `query`

Filters the graph by category, tag, or path substring. Returns matching nodes as JSON or as a Mermaid diagram.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `root` | `string` | yes | |
| `entryPoints` | `string[]` | no | Entry points to build the graph from. Omit to reuse the cached graph from a prior `analyze` call |
| `filter` | `string` | yes | Query string e.g. `category:logic` or `category:logic,tag:auth` |
| `mermaid` | `boolean` | no | Return a `graph TD` Mermaid string instead of JSON (default: `false`) |

**Returns:** filtered `SerializedGraph` JSON, or a Mermaid diagram string.

See the [Query Language Guide](./query.md) for the full filter syntax.

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

// Call tools via the client
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
  tools.ts          TOOL_DEFINITIONS — JSON Schema for all 9 tools
  handlers.ts       One handler function per tool
  utils.ts          text() response helper
```