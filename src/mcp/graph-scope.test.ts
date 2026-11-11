import { describe, expect, test } from "vitest";
import { type FlatWorkspaceGraph, Graph } from "../index";
import type { FileNode } from "../types/node";
import { restrictFlatToPackage, restrictToOwnFiles } from "./graph-scope";

const node = (p: string): FileNode => ({
  path: p,
  type: "typescript",
  category: "logic",
  imports: [],
  exports: [],
  tags: [],
  mtime: 1,
  size: 1,
});
const graphOf = (...paths: string[]) => new Graph(new Map(paths.map((p) => [p, node(p)])));

describe("restrictToOwnFiles", () => {
  test("drops nodes borrowed from other packages, keeping only those under the package root", () => {
    const graph = graphOf("pkg-a/src/a.ts", "pkg-b/src/b.ts", "pkg-a-extra/x.ts");
    const own = restrictToOwnFiles(graph, {
      name: "a",
      root: "/r/pkg-a",
      relativeRoot: "pkg-a",
      entryPoints: [],
    });
    expect([...own.nodes.keys()]).toEqual(["pkg-a/src/a.ts"]);
  });
});

describe("restrictFlatToPackage", () => {
  test("keeps only that package's nodes and prunes packageOf to match", () => {
    const flat: FlatWorkspaceGraph = {
      graph: graphOf("a/1.ts", "a/2.ts", "b/1.ts"),
      packageOf: new Map([
        ["a/1.ts", "a"],
        ["a/2.ts", "a"],
        ["b/1.ts", "b"],
      ]),
    };
    const out = restrictFlatToPackage(flat, "a");
    expect([...out.graph.nodes.keys()]).toEqual(["a/1.ts", "a/2.ts"]);
    expect([...out.packageOf.keys()]).toEqual(["a/1.ts", "a/2.ts"]);
  });

  test("an unknown package yields an empty graph rather than throwing", () => {
    const flat: FlatWorkspaceGraph = {
      graph: graphOf("a/1.ts"),
      packageOf: new Map([["a/1.ts", "a"]]),
    };
    expect(restrictFlatToPackage(flat, "zzz").graph.nodes.size).toBe(0);
  });
});
