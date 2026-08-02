import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import type { FileType } from "../types/parse";
import { Graph } from "./model";
import { findSymbol } from "./symbol";

function makeNode(
  p: string,
  type: FileType,
  exports: string[] = [],
  opts: { callEdges?: FileNode["callEdges"] } = {},
): FileNode {
  return {
    path: p,
    type,
    category: "logic",
    imports: [],
    exports: exports.map((name) => ({ name })),
    tags: [],
    mtime: 0,
    size: 0,
    ...(opts.callEdges ? { callEdges: opts.callEdges } : {}),
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("findSymbol", { tags: ["findSymbol", "Graph", "FileNode", "symbol"] }, () => {
  test("returns empty array when no file exports the symbol", () => {
    const graph = makeGraph([makeNode("src/a.ts", "typescript", ["otherFn"])]);
    expect(findSymbol(graph, "missingFn")).toEqual([]);
  });

  test("TS/JS match uses call precision with function-level callers", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", "typescript", ["parseFile"]),
      makeNode("src/builder.ts", "typescript", [], {
        callEdges: [{ from: "build", to: "parseFile", toFile: "src/parser.ts" }],
      }),
    ]);
    const matches = findSymbol(graph, "parseFile");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).toBe("src/parser.ts");
    expect(matches[0]?.precision).toBe("call");
    expect(matches[0]?.callers).toEqual([{ file: "src/builder.ts", callerFunction: "build" }]);
  });

  test("TS/JS match with no callers still gets call precision (empty callers)", () => {
    const graph = makeGraph([makeNode("src/parser.ts", "typescript", ["parseFile"])]);
    const matches = findSymbol(graph, "parseFile");
    expect(matches[0]?.precision).toBe("call");
    expect(matches[0]?.callers).toEqual([]);
  });

  test("Python match uses call precision now that the parser tracks call edges", () => {
    const graph = makeGraph([
      makeNode("src/utils.py", "python", ["helper", "other_helper"]),
      makeNode("src/main.py", "python", [], {
        callEdges: [{ from: "run", to: "helper", toFile: "src/utils.py" }],
      }),
    ]);
    const matches = findSymbol(graph, "helper");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.precision).toBe("call");
    expect(matches[0]?.callers).toEqual([{ file: "src/main.py", callerFunction: "run" }]);
  });

  test("Go match uses call precision now that the parser tracks call edges", () => {
    const graph = makeGraph([
      makeNode("src/util.go", "go", ["Helper"]),
      makeNode("src/main.go", "go", [], {
        callEdges: [{ from: "Run", to: "Helper", toFile: "src/util.go" }],
      }),
    ]);
    const matches = findSymbol(graph, "Helper");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.precision).toBe("call");
    expect(matches[0]?.callers).toEqual([{ file: "src/main.go", callerFunction: "Run" }]);
  });

  test("languages that never populate exports never produce a match", () => {
    const graph = makeGraph([makeNode("src/script.lua", "lua", [])]);
    expect(findSymbol(graph, "anything")).toEqual([]);
  });

  test("a symbol exported from two different files returns both as separate matches", () => {
    const graph = makeGraph([
      makeNode("src/a.ts", "typescript", ["shared"]),
      makeNode("src/b.ts", "typescript", ["shared"]),
    ]);
    const matches = findSymbol(graph, "shared");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
