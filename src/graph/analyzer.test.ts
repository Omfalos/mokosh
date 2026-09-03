import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge } from "../types/node";
import { GraphAnalyzer } from "./analyzer";

/** Builds a minimal FileNode with the given outgoing edges. */
function node(path: string, edges: Array<Partial<ImportEdge> & { toPath: string }>): FileNode {
  return {
    path,
    type: "java",
    category: "logic",
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
    imports: edges.map((edge) => ({
      fromPath: path,
      isStyle: false,
      rawSpecifier: "",
      type: "static",
      ...edge,
    })),
  };
}

describe("GraphAnalyzer.findCycles — isSamePackage edges", { tags: ["analyzer"] }, () => {
  test("a package wired only by synthetic same-package edges produces no cycles", () => {
    // A, B, C form a complete digraph via `isSamePackage` edges (the JVM clique).
    const paths = ["A.java", "B.java", "C.java"];
    const nodes = new Map<string, FileNode>();
    for (const p of paths) {
      nodes.set(
        p,
        node(
          p,
          paths.filter((other) => other !== p).map((toPath) => ({ toPath, isSamePackage: true })),
        ),
      );
    }
    expect(new GraphAnalyzer(nodes).findCycles()).toEqual([]);
  });

  test("a real import cycle is still detected alongside same-package edges", () => {
    const nodes = new Map<string, FileNode>([
      ["A.java", node("A.java", [{ toPath: "B.java" }, { toPath: "C.java", isSamePackage: true }])],
      ["B.java", node("B.java", [{ toPath: "A.java" }])],
      ["C.java", node("C.java", [{ toPath: "A.java", isSamePackage: true }])],
    ]);
    const cycles = new GraphAnalyzer(nodes).findCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["A.java", "B.java"]));
  });
});
