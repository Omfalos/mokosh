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

describe("queryCallGraph", {
  tags: ["CallEdge", "FileNode", "Graph", "model", "node", "queryCallGraph"],
}, () => {
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

  // --- definedInCandidateCount / ambiguity (docs/known_issues/13-call-graph-definition-ambiguity.md) ---

  test("unique name: definedInCandidateCount is 1, no regression in existing shape", () => {
    const graph = makeGraph([
      makeNode("src/parser.ts", ["parseFile"]),
      makeNode("src/other.ts", ["otherFn"]),
    ]);
    const result = queryCallGraph(graph, "parseFile");
    expect(result.definedIn).toBe("src/parser.ts");
    expect(result.definedInCandidateCount).toBe(1);
    expect(result.candidates).toBeUndefined();
  });

  test("missing name: definedInCandidateCount is 0, definedIn null", () => {
    const graph = makeGraph([makeNode("src/a.ts", ["otherFn"])]);
    const result = queryCallGraph(graph, "missingFn");
    expect(result.definedIn).toBeNull();
    expect(result.definedInCandidateCount).toBe(0);
  });

  test("two files exporting the same name: ambiguous, definedIn null, candidateCount 2, callees empty", () => {
    const graph = makeGraph([
      makeNode(
        "src/binding/yaml.go",
        ["Bind"],
        [{ from: "Bind", to: "decodeYaml", toFile: "src/binding/decode.go" }],
      ),
      makeNode("src/binding/json.go", ["Bind"]),
    ]);
    const result = queryCallGraph(graph, "Bind");
    expect(result.definedIn).toBeNull();
    expect(result.definedInCandidateCount).toBe(2);
    expect(result.callees).toHaveLength(0);
    expect(result.candidates).toBeUndefined();
  });

  test("ambiguous name: callers are still returned (independent of which file defines it)", () => {
    const graph = makeGraph([
      makeNode("src/binding/yaml.go", ["Bind"]),
      makeNode("src/binding/json.go", ["Bind"]),
      makeNode("src/engine.go", [], [{ from: "run", to: "Bind", toFile: "src/binding/yaml.go" }]),
    ]);
    const result = queryCallGraph(graph, "Bind");
    expect(result.definedIn).toBeNull();
    expect(result.definedInCandidateCount).toBe(2);
    expect(result.callers).toHaveLength(1);
    expect(result.callers[0]).toEqual({ file: "src/engine.go", callerFunction: "run" });
  });

  test("includeCandidates: true returns the full candidates list when ambiguous", () => {
    const graph = makeGraph([
      makeNode("src/binding/yaml.go", ["Bind"]),
      makeNode("src/binding/json.go", ["Bind"]),
    ]);
    const result = queryCallGraph(graph, "Bind", { includeCandidates: true });
    expect(result.definedInCandidateCount).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates).toContain("src/binding/yaml.go");
    expect(result.candidates).toContain("src/binding/json.go");
  });

  test("includeCandidates: true on a unique name returns a single-entry candidates list", () => {
    const graph = makeGraph([makeNode("src/parser.ts", ["parseFile"])]);
    const result = queryCallGraph(graph, "parseFile", { includeCandidates: true });
    expect(result.definedInCandidateCount).toBe(1);
    expect(result.candidates).toEqual(["src/parser.ts"]);
  });

  test("file disambiguator narrows an ambiguous name to a precise, unambiguous answer", () => {
    const graph = makeGraph([
      makeNode(
        "src/binding/yaml.go",
        ["Bind"],
        [{ from: "Bind", to: "decodeYaml", toFile: "src/binding/decode.go" }],
      ),
      makeNode(
        "src/binding/json.go",
        ["Bind"],
        [{ from: "Bind", to: "decodeJson", toFile: "src/binding/decode.go" }],
      ),
      makeNode("src/binding/xml.go", ["Bind"]),
    ]);
    const result = queryCallGraph(graph, "Bind", { file: "src/binding/json.go" });
    expect(result.definedIn).toBe("src/binding/json.go");
    expect(result.definedInCandidateCount).toBe(1);
    expect(result.callees).toHaveLength(1);
    expect(result.callees[0]).toEqual({
      file: "src/binding/decode.go",
      calleeFunction: "decodeJson",
    });
  });

  test("file disambiguator for a file that doesn't export the name yields no match", () => {
    const graph = makeGraph([
      makeNode("src/binding/yaml.go", ["Bind"]),
      makeNode("src/binding/json.go", ["Bind"]),
    ]);
    const result = queryCallGraph(graph, "Bind", { file: "src/other.ts" });
    expect(result.definedIn).toBeNull();
    expect(result.definedInCandidateCount).toBe(0);
  });

  test("real-repo-shaped regression: many files exporting the same name (off-by-one guard)", () => {
    // Mirrors mokosh's own in-repo collision: 25 files export a top-level `run` function (24 CLI
    // commands + the dispatcher in src/cli/runner.ts) — a synthetic fixture with a comparable
    // candidate count, to catch an off-by-one bug a 2-node fixture could hide.
    const commandNodes = Array.from({ length: 24 }, (_, i) =>
      makeNode(`src/cli/commands/cmd${i}.ts`, ["run"]),
    );
    const dispatcherNode = makeNode(
      "src/cli/runner.ts",
      ["run"],
      [{ from: "run", to: "parseArgs", toFile: "src/cli/args.ts" }],
    );
    const graph = makeGraph([
      ...commandNodes,
      dispatcherNode,
      makeNode("src/cli/args.ts", ["parseArgs"]),
    ]);

    const ambiguous = queryCallGraph(graph, "run", { includeCandidates: true });
    expect(ambiguous.definedInCandidateCount).toBe(25);
    expect(ambiguous.candidates).toHaveLength(25);
    expect(ambiguous.definedIn).toBeNull();
    expect(ambiguous.callees).toHaveLength(0);

    const disambiguated = queryCallGraph(graph, "run", { file: "src/cli/runner.ts" });
    expect(disambiguated.definedInCandidateCount).toBe(1);
    expect(disambiguated.definedIn).toBe("src/cli/runner.ts");
    expect(disambiguated.callees).toEqual([
      { file: "src/cli/args.ts", calleeFunction: "parseArgs" },
    ]);
  });
});
