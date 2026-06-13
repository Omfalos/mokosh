import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import { Graph } from "./model";
import { buildTypeGraph, queryTypeGraph } from "./type-graph";

function makeNode(
  p: string,
  category: FileNode["category"] = "logic",
  exports: Array<{ name: string; signature?: string; doc?: string }> = [],
  imports: Array<{ toPath: string; symbols: string[] }> = [],
): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    exports: exports.map((e) => ({
      name: e.name,
      ...(e.signature ? { signature: e.signature } : {}),
      ...(e.doc ? { doc: e.doc } : {}),
    })),
    imports: imports.map((i) => ({
      fromPath: p,
      toPath: i.toPath,
      rawSpecifier: `./${i.toPath}`,
      type: "static" as const,
      isStyle: false,
      isExternal: false,
      symbols: i.symbols,
    })),
    tags: [],
    mtime: 0,
    size: 0,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("buildTypeGraph", () => {
  test("returns empty maps for empty graph", () => {
    const tg = buildTypeGraph(new Graph(new Map()));
    expect(tg.types.size).toBe(0);
    expect(tg.edges).toHaveLength(0);
  });

  test("includes interface exports", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
    ]);
    const tg = buildTypeGraph(graph);
    const node = tg.types.get("src/types.ts::User");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("interface");
  });

  test("includes class exports", () => {
    const graph = makeGraph([
      makeNode("src/graph.ts", "logic", [{ name: "Graph", signature: "class Graph" }]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.get("src/graph.ts::Graph")?.kind).toBe("class");
  });

  test("includes enum exports", () => {
    const graph = makeGraph([
      makeNode("src/parse.ts", "type-only", [{ name: "FileType", signature: "enum FileType" }]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.get("src/parse.ts::FileType")?.kind).toBe("enum");
  });

  test("type-only files include all exports as type nodes regardless of signature", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "MyAlias", signature: "string | number" }]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.has("src/types.ts::MyAlias")).toBe(true);
  });

  test("excludes plain function exports from logic files", () => {
    const graph = makeGraph([
      makeNode("src/utils.ts", "logic", [
        { name: "parseFile", signature: "(path: string) => ParseResult" },
      ]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.has("src/utils.ts::parseFile")).toBe(false);
  });

  test("builds edges when symbols match type exports", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
      makeNode("src/service.ts", "logic", [], [{ toPath: "src/types.ts", symbols: ["User"] }]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.edges).toHaveLength(1);
    expect(tg.edges[0]).toEqual({
      fromFile: "src/service.ts",
      toType: "User",
      toFile: "src/types.ts",
    });
  });

  test("does not build edges for non-type symbol imports", () => {
    const graph = makeGraph([
      makeNode("src/utils.ts", "logic", [{ name: "parseFile", signature: "(p: string) => void" }]),
      makeNode("src/service.ts", "logic", [], [{ toPath: "src/utils.ts", symbols: ["parseFile"] }]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.edges).toHaveLength(0);
  });

  test("attaches doc when present", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [
        { name: "User", signature: "interface User", doc: "Represents a user account." },
      ]),
    ]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.get("src/types.ts::User")?.doc).toBe("Represents a user account.");
  });

  test("skips non-TS file types", () => {
    const node: FileNode = {
      path: "src/styles.css",
      type: "css",
      category: "other",
      imports: [],
      exports: [{ name: "SomeExport" }],
      tags: [],
      mtime: 0,
      size: 0,
    };
    const graph = makeGraph([node]);
    const tg = buildTypeGraph(graph);
    expect(tg.types.size).toBe(0);
  });
});

describe("queryTypeGraph", () => {
  test("returns null type when name not found", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
    ]);
    const tg = buildTypeGraph(graph);
    const result = queryTypeGraph(tg, "MissingType");
    expect(result.type).toBeNull();
    expect(result.usedByFiles).toHaveLength(0);
    expect(result.uses).toHaveLength(0);
  });

  test("finds the type node", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
    ]);
    const tg = buildTypeGraph(graph);
    const result = queryTypeGraph(tg, "User");
    expect(result.type?.name).toBe("User");
    expect(result.type?.file).toBe("src/types.ts");
  });

  test("returns files that import the type in usedByFiles", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
      makeNode("src/service.ts", "logic", [], [{ toPath: "src/types.ts", symbols: ["User"] }]),
      makeNode("src/handler.ts", "logic", [], [{ toPath: "src/types.ts", symbols: ["User"] }]),
    ]);
    const tg = buildTypeGraph(graph);
    const result = queryTypeGraph(tg, "User");
    expect(result.usedByFiles).toContain("src/service.ts");
    expect(result.usedByFiles).toContain("src/handler.ts");
  });

  test("returns types that the defining file imports in uses", () => {
    const graph = makeGraph([
      makeNode("src/base.ts", "type-only", [{ name: "Base", signature: "interface Base" }]),
      makeNode(
        "src/types.ts",
        "type-only",
        [{ name: "User", signature: "interface User" }],
        [{ toPath: "src/base.ts", symbols: ["Base"] }],
      ),
    ]);
    const tg = buildTypeGraph(graph);
    const result = queryTypeGraph(tg, "User");
    expect(result.uses).toHaveLength(1);
    expect(result.uses[0]?.name).toBe("Base");
  });

  test("deduplicates usedByFiles", () => {
    const graph = makeGraph([
      makeNode("src/types.ts", "type-only", [{ name: "User", signature: "interface User" }]),
      makeNode("src/service.ts", "logic", [], [{ toPath: "src/types.ts", symbols: ["User"] }]),
    ]);
    const tg = buildTypeGraph(graph);
    const result = queryTypeGraph(tg, "User");
    const unique = new Set(result.usedByFiles);
    expect(unique.size).toBe(result.usedByFiles.length);
  });
});
