import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge } from "../types/node";
import type { FileType } from "../types/parse";
import { Graph } from "./model";
import { findSymbol } from "./symbol";

function makeNode(
  p: string,
  type: FileType,
  exports: string[] = [],
  opts: { callEdges?: FileNode["callEdges"]; imports?: ImportEdge[] } = {},
): FileNode {
  return {
    path: p,
    type,
    category: "logic",
    imports: opts.imports ?? [],
    exports: exports.map((name) => ({ name })),
    tags: [],
    mtime: 0,
    size: 0,
    ...(opts.callEdges ? { callEdges: opts.callEdges } : {}),
  };
}

function importEdge(fromPath: string, toPath: string, symbols?: string[]): ImportEdge {
  return {
    fromPath,
    toPath,
    isStyle: false,
    rawSpecifier: toPath,
    type: "static",
    symbols,
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

  test("Python match uses import-symbol precision, filtered to edges naming this symbol", () => {
    const graph = makeGraph([
      makeNode("src/utils.py", "python", ["helper", "other_helper"]),
      makeNode("src/main.py", "python", [], {
        imports: [importEdge("src/main.py", "src/utils.py", ["helper"])],
      }),
      makeNode("src/unrelated.py", "python", [], {
        imports: [importEdge("src/unrelated.py", "src/utils.py", ["other_helper"])],
      }),
    ]);
    const matches = findSymbol(graph, "helper");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.precision).toBe("import-symbol");
    expect(matches[0]?.importers).toEqual([{ file: "src/main.py", symbols: ["helper"] }]);
  });

  test("Go match falls back to file-level precision via whole-file dependents", () => {
    const graph = makeGraph([
      makeNode("src/util.go", "go", ["Helper"]),
      makeNode("src/main.go", "go", [], { imports: [importEdge("src/main.go", "src/util.go")] }),
    ]);
    const matches = findSymbol(graph, "Helper");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.precision).toBe("file-level");
    expect(matches[0]?.importers).toEqual([{ file: "src/main.go" }]);
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
