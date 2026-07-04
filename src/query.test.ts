import { describe, expect, test } from "vitest";
import type { SerializedGraph } from "../src/types/graph";
import { filterGraph, parseQuery } from "./query";

describe("QueryEngine", { tags: ["SerializedGraph", "filterGraph", "graph", "parseQuery"] }, () => {
  const mockGraph: SerializedGraph = {
    nodes: [
      {
        path: "src/logic.ts",
        type: "typescript",
        category: "logic",
        tags: [{ name: "auth", kind: "comment-marker" as const }],
        imports: [
          {
            fromPath: "src/logic.ts",
            toPath: "src/util.ts",
            isStyle: false,
            rawSpecifier: "./util",
            type: "static",
          },
        ],
        exports: [],
        mtime: 0,
        size: 0,
      },
      {
        path: "src/util.ts",
        type: "typescript",
        category: "other",
        tags: [],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
      },
      {
        path: "src/ui.tsx",
        type: "typescript",
        category: "ui",
        tags: [{ name: "theme", kind: "comment-marker" as const }],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
      },
    ],
  };

  test("should parse query string", () => {
    const query = parseQuery("category:logic,tag:auth");
    expect(query).toEqual({ category: "logic", tags: ["auth"] });
  });

  test("should parse multi-value tags", () => {
    const query = parseQuery("tag:auth,tag:payments");
    expect(query).toEqual({ tags: ["auth", "payments"] });
  });

  test("should parse negated values", () => {
    const query = parseQuery("category:!test,tag:!internal");
    expect(query).toEqual({ category: "!test", tags: ["!internal"] });
  });

  test("should filter graph by category", () => {
    const query = { category: "logic" };
    const filtered = filterGraph(mockGraph, query);
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0]?.path).toBe("src/logic.ts");
    // Import to src/util.ts should be removed because src/util.ts is not in filtered nodes
    expect(filtered.nodes[0]?.imports).toHaveLength(0);
  });

  test("should filter graph by tag", () => {
    const query = { tags: ["theme"] };
    const filtered = filterGraph(mockGraph, query);
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0]?.path).toBe("src/ui.tsx");
  });

  test("should filter graph by path", () => {
    const query = { path: "logic" };
    const filtered = filterGraph(mockGraph, query);
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0]?.path).toBe("src/logic.ts");
  });

  test("should support multiple filters (AND across fields)", () => {
    const query = { category: "ui", tags: ["theme"] };
    const filtered = filterGraph(mockGraph, query);
    expect(filtered.nodes).toHaveLength(1);
    expect(filtered.nodes[0]?.path).toBe("src/ui.tsx");

    const query2 = { category: "logic", tags: ["theme"] };
    const filtered2 = filterGraph(mockGraph, query2);
    expect(filtered2.nodes).toHaveLength(0);
  });

  test("should support OR logic across tags", () => {
    const query = { tags: ["auth", "theme"] };
    const filtered = filterGraph(mockGraph, query);
    expect(filtered.nodes).toHaveLength(2);
    expect(filtered.nodes.map((n) => n.path).sort()).toEqual(["src/logic.ts", "src/ui.tsx"]);
  });

  test("should support negated category", () => {
    const filtered = filterGraph(mockGraph, { category: "!other" });
    expect(filtered.nodes.map((n) => n.path).sort()).toEqual(["src/logic.ts", "src/ui.tsx"]);
  });

  test("should support negated tag", () => {
    const filtered = filterGraph(mockGraph, { tags: ["!auth"] });
    expect(filtered.nodes.map((n) => n.path).sort()).toEqual(["src/ui.tsx", "src/util.ts"]);
  });

  test("should filter by isExternal (nodes with external imports)", () => {
    const filtered = filterGraph(mockGraph, { isExternal: true });
    expect(filtered.nodes).toHaveLength(0);

    const filtered2 = filterGraph(mockGraph, { isExternal: false });
    expect(filtered2.nodes).toHaveLength(3);
  });
});
