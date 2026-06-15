import { describe, expect, test } from "vitest";
import type { CallEdge, FileNode } from "../../types/node";
import { Graph } from "../model";
import { queryCallGraph } from "./index";

function makeNode(p: string, exports: string[] = [], callEdges: CallEdge[] = []): FileNode {
  return {
    path: p,
    type: "typescript",
    category: "logic",
    imports: [],
    exports: exports.map((name) => ({ name })),
    tags: [],
    mtime: 0,
    size: 0,
    callEdges,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("queryCallGraph", () => {
  test("returns null definedIn when function is not exported by any file", () => {
    const graph = makeGraph([makeNode("src/a.ts", ["otherFn"])]);
    const result = queryCallGraph(graph, "missingFn");
    expect(result.definedIn).toBeNull();
    expect(result.callers).toHaveLength(0);
    expect(result.callees).toHaveLength(0);
  });

  test("finds definedIn from exports", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode("src/other.ts", ["otherFn"]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.definedIn).toBe("src/parser.ts");
  });

  test("finds callers from other files call edges", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode("src/builder.ts", [], [{ from: "build", to: "parseFile", toFile: "src/parser.ts" }]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]).toEqual({ file: "src/builder.ts", callerFunction: "build" });
  });

  test("finds callees from defining file call edges", () => {
    const graph = makeGraph([
      makeNode(
        "src/parser.ts",
        ["parseFile"],
        [
          { from: "parseFile", to: "tokenize", toFile: "src/lexer.ts" },
          { from: "parseFile", to: "buildAST", toFile: "src/ast.ts" },
        ],
      ),
      makeNode("src/lexer.ts", ["tokenize"]),
      makeNode("src/ast.ts", ["buildAST"]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callees).toHaveLength(2);
    expect(result.callees).toContainEqual({ file: "src/lexer.ts", calleeFunction: "tokenize" });
    expect(result.callees).toContainEqual({ file: "src/ast.ts", calleeFunction: "buildAST" });
  });

  test("does not include call edges from other functions in the defining file as callees", () => {
    const graph = makeGraph([
      makeNode(
        "src/parser.ts",
        ["parseFile", "parseImports"],
        [
          { from: "parseFile", to: "tokenize", toFile: "src/lexer.ts" },
          { from: "parseImports", to: "resolve", toFile: "src/resolver.ts" },
        ],
      ),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callees).toHaveLength(1);
    expect(result.callees[0]?.calleeFunction).toBe("tokenize");
  });

  test("collects multiple callers from different files", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode("src/builder.ts", [], [{ from: "build", to: "parseFile", toFile: "src/parser.ts" }]),
      makeNode("src/cli.ts", [], [{ from: "run", to: "parseFile", toFile: "src/parser.ts" }]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callers).toHaveLength(2);
    expect(result.callers.map((c) => c.file)).toContain("src/builder.ts");
    expect(result.callers.map((c) => c.file)).toContain("src/cli.ts");
  });

  test("returns function name in result", () => {
    const graph = makeGraph([makeNode("src/a.ts", ["fn"])]);
    const result = queryCallGraph(graph, "fn");
    expect(result.functionName).toBe("fn");
  });

  test("returns empty callers and callees when no call edges exist", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode("src/other.ts", ["otherFn"]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callers).toHaveLength(0);
    expect(result.callees).toHaveLength(0);
  });

  test("ignores call edges targeting other functions when finding callers", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode(
        "src/builder.ts",
        [],
        [{ from: "build", to: "resolveImports", toFile: "src/resolver.ts" }],
      ),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callers).toHaveLength(0);
  });

  test("finds callers from class methods using ClassName.method format", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode(
        "src/builder.ts",
        [],
        [{ from: "GraphBuilder.build", to: "parseFile", toFile: "src/parser.ts" }],
      ),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]).toEqual({
      file: "src/builder.ts",
      callerFunction: "GraphBuilder.build",
    });
  });
});
