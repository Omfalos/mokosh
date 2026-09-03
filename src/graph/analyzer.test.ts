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

  test("includeKinds: ['samePackage'] opts the clique back in", () => {
    const paths = ["A.java", "B.java"];
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
    expect(new GraphAnalyzer(nodes).findCycles({ includeKinds: ["samePackage"] })).not.toEqual([]);
  });
});

describe("GraphAnalyzer.findCycles — isDocReference edges", { tags: ["analyzer"] }, () => {
  test("a loop made only of doc-reference edges produces no cycles by default", () => {
    const nodes = new Map<string, FileNode>([
      ["docs/a.md", node("docs/a.md", [{ toPath: "docs/b.md", isDocReference: true }])],
      ["docs/b.md", node("docs/b.md", [{ toPath: "docs/a.md", isDocReference: true }])],
    ]);
    expect(new GraphAnalyzer(nodes).findCycles()).toEqual([]);
  });

  test("includeKinds: ['docReference'] surfaces the doc-link loop", () => {
    const nodes = new Map<string, FileNode>([
      ["docs/a.md", node("docs/a.md", [{ toPath: "docs/b.md", isDocReference: true }])],
      ["docs/b.md", node("docs/b.md", [{ toPath: "docs/a.md", isDocReference: true }])],
    ]);
    const cycles = new GraphAnalyzer(nodes).findCycles({ includeKinds: ["docReference"] });
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["docs/a.md", "docs/b.md"]));
  });

  test("a real code cycle is still reported when a doc-reference back-edge is also present", () => {
    const nodes = new Map<string, FileNode>([
      ["src/a.ts", node("src/a.ts", [{ toPath: "src/b.ts" }])],
      ["src/b.ts", node("src/b.ts", [{ toPath: "src/a.ts" }])],
      ["docs/a.md", node("docs/a.md", [{ toPath: "src/a.ts", isDocReference: true }])],
    ]);
    // src/a.ts also references the doc, closing a doc-only loop that must not be reported.
    nodes.get("src/a.ts")?.imports.push({
      fromPath: "src/a.ts",
      toPath: "docs/a.md",
      rawSpecifier: "docs/a.md",
      isStyle: false,
      type: "static",
      isDocReference: true,
    });
    const cycles = new GraphAnalyzer(nodes).findCycles();
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
  });
});
