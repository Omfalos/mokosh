import { describe, expect, test } from "vitest";
import type { FileNode } from "../../types/node";
import { Graph } from "../model";
import { buildResponsibilityGraph } from "./index";

function makeNode(
  p: string,
  category: FileNode["category"] = "logic",
  exports: string[] = [],
  description?: string,
  imports: string[] = [],
): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    exports: exports.map((name) => ({ name })),
    imports: imports.map((target) => ({
      fromPath: p,
      toPath: target,
      rawSpecifier: `./${target}`,
      type: "static" as const,
      isStyle: false,
      isExternal: false,
    })),
    tags: [],
    mtime: 0,
    size: 0,
    ...(description ? { description } : {}),
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("buildResponsibilityGraph", {
  tags: ["FileNode", "Graph", "buildResponsibilityGraph", "model", "node"],
}, () => {
  test("returns empty map for empty graph", () => {
    const rg = buildResponsibilityGraph(new Graph(new Map()));
    expect(rg.size).toBe(0);
  });

  test("includes every node in the graph", () => {
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.has("src/a.ts")).toBe(true);
    expect(rg.has("src/b.ts")).toBe(true);
  });

  test("attaches description from FileNode.description", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", "logic", [], "Aggregates language parsers."),
    ]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/parser.ts")?.description).toBe("Aggregates language parsers.");
  });

  test("omits description when file has none", () => {
    const graph = makeGraph([makeNode("src/utils.ts")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/utils.ts")?.description).toBeUndefined();
  });

  test("lists export names", () => {
    const graph = makeGraph([makeNode("src/parser.ts", "logic", ["parseFile", "parseImports"])]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/parser.ts")?.exports).toEqual(["parseFile", "parseImports"]);
  });

  test("infers role: test for test category", () => {
    const graph = makeGraph([makeNode("src/parser.test.ts", "test")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/parser.test.ts")?.role).toBe("test");
  });

  test("infers role: types for type-only category", () => {
    const graph = makeGraph([makeNode("src/types/node.ts", "type-only")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/types/node.ts")?.role).toBe("types");
  });

  test("infers role: cli for files in /cli/ path", () => {
    const graph = makeGraph([makeNode("src/cli/runner.ts", "logic")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/cli/runner.ts")?.role).toBe("cli");
  });

  test("infers role: parser for files in /parser/ path", () => {
    const graph = makeGraph([makeNode("src/parser/lang/typescript.ts", "logic")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/parser/lang/typescript.ts")?.role).toBe("parser");
  });

  test("infers role: service for files in /services/ path", () => {
    const graph = makeGraph([makeNode("src/services/auth.ts", "logic")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/services/auth.ts")?.role).toBe("service");
  });

  test("infers role: component for files in /components/ path", () => {
    const graph = makeGraph([makeNode("src/components/Button.ts", "logic")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/components/Button.ts")?.role).toBe("component");
  });

  test("infers role: other for unrecognised paths", () => {
    const graph = makeGraph([makeNode("src/graph/workspace/index.ts", "logic")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/graph/workspace/index.ts")?.role).toBe("other");
  });

  test("assigns featureHub when file belongs to a domain", () => {
    // hub with 5 imports qualifies as feature hub
    const hub = makeNode("src/hub.ts", "logic", [], undefined, [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
    ]);
    const rg = buildResponsibilityGraph(graph, { minOutDegree: 5 });
    expect(rg.get("src/a.ts")?.featureHub).toBe("hub");
    expect(rg.get("src/hub.ts")?.featureHub).toBe("hub");
  });

  test("omits featureHub when file is unassigned", () => {
    const graph = makeGraph([makeNode("src/orphan.ts")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/orphan.ts")?.featureHub).toBeUndefined();
  });

  test("path on responsibility matches node path", () => {
    const graph = makeGraph([makeNode("src/foo.ts")]);
    const rg = buildResponsibilityGraph(graph);
    expect(rg.get("src/foo.ts")?.path).toBe("src/foo.ts");
  });
});
