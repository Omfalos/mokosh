import { describe, expect, test } from "vitest";
import {
  DEFAULT_TYPE_INVENTORY_LIMIT,
  summarizeTypeInventory,
  TYPE_DOC_MAX_CHARS,
  type TypeGraph,
  type TypeNode,
} from "./type-graph";

function graphOf(nodes: TypeNode[]): TypeGraph {
  return { types: new Map(nodes.map((node) => [`${node.file}::${node.name}`, node])), edges: [] };
}

const nodes: TypeNode[] = [
  { name: "A", file: "src/a.ts", kind: "interface", doc: "First line.\nSecond line.\nThird." },
  { name: "B", file: "src/b.ts", kind: "class" },
  { name: "C", file: "lib/c.ts", kind: "interface", doc: "x".repeat(300) },
  { name: "D", file: "lib/d.ts", kind: "enum", doc: "\n   " },
];

describe("summarizeTypeInventory", () => {
  test("shortens docs to the first line and caps very long ones", () => {
    const { types } = summarizeTypeInventory(graphOf(nodes));
    expect(types.find((type) => type.name === "A")?.doc).toBe("First line.");
    const long = types.find((type) => type.name === "C")?.doc ?? "";
    expect(long.length).toBe(TYPE_DOC_MAX_CHARS);
    expect(long.endsWith("…")).toBe(true);
    expect(types.find((type) => type.name === "D")).not.toHaveProperty("doc");
  });

  test("byKind and matched cover everything that matched, not just the page", () => {
    const result = summarizeTypeInventory(graphOf(nodes), { limit: 1 });
    expect(result.count).toBe(1);
    expect(result.matched).toBe(4);
    expect(result.byKind).toEqual({ interface: 2, class: 1, enum: 1 });
    expect(result.truncated).toBe(true);
    expect(result.hint).toMatch(/kind|path|limit/);
  });

  test("kind and path filters compose", () => {
    const result = summarizeTypeInventory(graphOf(nodes), { kind: "interface", path: "lib/" });
    expect(result.types.map((type) => type.name)).toEqual(["C"]);
    expect(result.matched).toBe(1);
    expect(result.truncated).toBeUndefined();
  });

  test("default limit applies when none is given", () => {
    const many = Array.from({ length: DEFAULT_TYPE_INVENTORY_LIMIT + 5 }, (_, index) => ({
      name: `T${index}`,
      file: "f.ts",
      kind: "type" as const,
    }));
    const result = summarizeTypeInventory(graphOf(many));
    expect(result.count).toBe(DEFAULT_TYPE_INVENTORY_LIMIT);
    expect(result.matched).toBe(DEFAULT_TYPE_INVENTORY_LIMIT + 5);
  });

  test("does not mutate the source graph's docs", () => {
    const graph = graphOf(nodes);
    summarizeTypeInventory(graph);
    expect(graph.types.get("src/a.ts::A")?.doc).toBe("First line.\nSecond line.\nThird.");
  });
});
