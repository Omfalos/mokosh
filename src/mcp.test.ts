import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { createMcpServer } from "./mcp";

const tempRoots: string[] = [];

function makeProject(name: string, files: Record<string, string>): string {
  const root = path.join(process.cwd(), name);
  fs.mkdirSync(root, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), content);
  }
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function makeClient(): Promise<Client> {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type ContentItem = { text: string } & Record<string, unknown>;

function parseText(result: ToolResult): unknown {
  const c = (result.content as ContentItem[])[0];
  if (!c || !("text" in c)) throw new Error("Expected text content");
  return JSON.parse(c.text);
}

function getText(result: ToolResult): string {
  const c = (result.content as ContentItem[])[0];
  if (!c || !("text" in c)) throw new Error("Expected text content");
  return c.text;
}

describe("mokosh MCP server", () => {
  test("listTools returns all 14 tools", async () => {
    const client = await makeClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "analyze",
      "clear_cache",
      "detect_features",
      "find_uncovered",
      "find_unused",
      "get_affected",
      "get_callers",
      "get_dependencies",
      "get_dependents",
      "get_workspace_affected",
      "get_workspace_packages",
      "propose_affected_tests",
      "propose_tags",
      "query",
    ]);
  });

  describe("analyze", () => {
    test("returns node count and categories", async () => {
      const root = makeProject("mcp-analyze", {
        "main.js": "import './a.js'; import './b.js'",
        "a.js": "",
        "b.js": "",
      });
      const client = await makeClient();
      const data = parseText(
        await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["main.js"] } }),
      ) as { nodeCount: number; cycles: unknown[] };
      expect(data.nodeCount).toBe(3);
      expect(data.cycles).toEqual([]);
    });

    test("detects cycles", async () => {
      const root = makeProject("mcp-cycles", {
        "a.js": "import './b.js'",
        "b.js": "import './a.js'",
      });
      const client = await makeClient();
      const data = parseText(
        await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["a.js"] } }),
      ) as { cycles: unknown[] };
      expect(data.cycles.length).toBeGreaterThan(0);
    });
  });

  describe("get_dependencies", () => {
    test("returns immediate imports at depth 1", async () => {
      const root = makeProject("mcp-deps", {
        "main.js": "import './a.js'",
        "a.js": "import './b.js'",
        "b.js": "",
      });
      const client = await makeClient();
      await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["main.js"] } });

      const data = parseText(
        await client.callTool({ name: "get_dependencies", arguments: { root, file: "main.js" } }),
      ) as { dependencies: string[] };
      expect(data.dependencies).toContain("a.js");
      expect(data.dependencies).not.toContain("b.js");
    });

    test("returns full transitive tree when depth > 1", async () => {
      const root = makeProject("mcp-deps-deep", {
        "main.js": "import './a.js'",
        "a.js": "import './b.js'",
        "b.js": "",
      });
      const client = await makeClient();
      await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["main.js"] } });

      const data = parseText(
        await client.callTool({
          name: "get_dependencies",
          arguments: { root, file: "main.js", depth: 10 },
        }),
      ) as { dependencies: string[] };
      expect(data.dependencies).toContain("a.js");
      expect(data.dependencies).toContain("b.js");
    });
  });

  describe("get_dependents", () => {
    test("returns direct importers", async () => {
      const root = makeProject("mcp-dependents", {
        "main.js": "import './a.js'",
        "a.js": "",
      });
      const client = await makeClient();
      await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["main.js"] } });

      const data = parseText(
        await client.callTool({ name: "get_dependents", arguments: { root, file: "a.js" } }),
      ) as { dependents: string[] };
      expect(data.dependents).toContain("main.js");
    });
  });

  describe("get_affected", () => {
    test("returns all upstream files", async () => {
      const root = makeProject("mcp-affected", {
        "main.js": "import './a.js'",
        "a.js": "import './b.js'",
        "b.js": "",
      });
      const client = await makeClient();
      await client.callTool({ name: "analyze", arguments: { root, entryPoints: ["main.js"] } });

      const data = parseText(
        await client.callTool({ name: "get_affected", arguments: { root, file: "b.js" } }),
      ) as { affected: string[] };
      expect(data.affected).toContain("a.js");
      expect(data.affected).toContain("main.js");
    });

    test("testsOnly filters to test files", async () => {
      const root = makeProject("mcp-affected-tests", {
        "main.js": "import './a.js'",
        "a.js": "",
        "a.test.js": "import './a.js'",
      });
      const client = await makeClient();
      await client.callTool({
        name: "analyze",
        arguments: { root, entryPoints: ["main.js", "a.test.js"] },
      });

      const data = parseText(
        await client.callTool({
          name: "get_affected",
          arguments: { root, file: "a.js", testsOnly: true },
        }),
      ) as { affected: string[] };
      expect(data.affected).toContain("a.test.js");
      expect(data.affected).not.toContain("main.js");
    });
  });

  describe("find_unused", () => {
    test("returns files not reachable from entry points", async () => {
      const root = makeProject("mcp-unused", {
        "main.js": "import './a.js'",
        "a.js": "",
        "orphan.js": "",
      });
      const client = await makeClient();
      const data = parseText(
        await client.callTool({
          name: "find_unused",
          arguments: { root, entryPoints: ["main.js"] },
        }),
      ) as { unusedFiles: string[] };
      expect(data.unusedFiles).toContain("orphan.js");
      expect(data.unusedFiles).not.toContain("main.js");
      expect(data.unusedFiles).not.toContain("a.js");
    });
  });

  describe("propose_tags", () => {
    test("returns tags covering test files affected by changed files", async () => {
      const root = makeProject("mcp-tags", {
        "a.js": "",
        "a.test.js": "import './a.js'",
      });
      const client = await makeClient();
      await client.callTool({
        name: "analyze",
        arguments: { root, entryPoints: ["a.test.js"] },
      });

      const data = parseText(
        await client.callTool({
          name: "propose_tags",
          arguments: { root, changedFiles: ["a.js"] },
        }),
      ) as { proposedTags: string[] };
      expect(data.proposedTags).toContain("a");
    });
  });

  describe("query", () => {
    test("filters graph by category", async () => {
      const root = makeProject("mcp-query", {
        "main.js": "import './a.js'",
        "a.js": "",
      });
      const client = await makeClient();
      const data = parseText(
        await client.callTool({
          name: "query",
          arguments: { root, entryPoints: ["main.js"], filter: "category:other" },
        }),
      ) as { nodes: Array<{ category: string }> };
      expect(data.nodes.length).toEqual(0);
      for (const node of data.nodes) {
        expect(node.category).toBe("other");
      }
    });

    test("returns a Mermaid diagram when mermaid=true", async () => {
      const root = makeProject("mcp-query-mermaid", {
        "main.js": "import './a.js'",
        "a.js": "",
      });
      const client = await makeClient();
      const result = await client.callTool({
        name: "query",
        arguments: { root, entryPoints: ["main.js"], filter: "category:other", mermaid: true },
      });
      expect(getText(result)).toContain("graph TD");
    });
  });

  test("returns an error when called before analyze", async () => {
    const root = makeProject("mcp-no-analyze", { "main.js": "" });
    const client = await makeClient();
    const result = await client.callTool({
      name: "get_dependencies",
      arguments: { root, file: "main.js" },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("analyze");
  });
});
