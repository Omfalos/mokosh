import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import type { FileType } from "../types/parse";
import { getLanguageCoverage } from "./language-support";
import { Graph } from "./model";

function makeNode(p: string, type: FileType): FileNode {
  return {
    path: p,
    type,
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("getLanguageCoverage", { tags: ["getLanguageCoverage", "Graph", "FileNode"] }, () => {
  test("reports fileCount and tracked capabilities per language present in the graph", () => {
    const graph = makeGraph([
      makeNode("src/a.ts", "typescript"),
      makeNode("src/b.ts", "typescript"),
      makeNode("src/c.py", "python"),
      makeNode("src/d.go", "go"),
      makeNode("src/e.lua", "lua"),
    ]);

    const coverage = getLanguageCoverage(graph);

    expect(coverage).toEqual([
      {
        type: "typescript",
        fileCount: 2,
        exportsTracked: true,
        importSymbolsTracked: true,
        callEdgesTracked: true,
      },
      {
        type: "python",
        fileCount: 1,
        exportsTracked: true,
        importSymbolsTracked: true,
        callEdgesTracked: false,
      },
      {
        type: "go",
        fileCount: 1,
        exportsTracked: true,
        importSymbolsTracked: false,
        callEdgesTracked: false,
      },
      {
        type: "lua",
        fileCount: 1,
        exportsTracked: false,
        importSymbolsTracked: false,
        callEdgesTracked: false,
      },
    ]);
  });

  test("reports exportsTracked for SCSS and Less (root-level variable/mixin/function exports)", () => {
    const graph = makeGraph([makeNode("src/a.scss", "scss"), makeNode("src/b.less", "less")]);

    const coverage = getLanguageCoverage(graph);

    expect(coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "scss", exportsTracked: true }),
        expect.objectContaining({ type: "less", exportsTracked: true }),
      ]),
    );
  });

  test("sorts by file count descending", () => {
    const graph = makeGraph([
      makeNode("src/a.lua", "lua"),
      makeNode("src/b.ts", "typescript"),
      makeNode("src/c.ts", "typescript"),
      makeNode("src/d.ts", "typescript"),
    ]);

    expect(getLanguageCoverage(graph).map((c) => c.type)).toEqual(["typescript", "lua"]);
  });

  test("omits languages with zero files in the graph", () => {
    const graph = makeGraph([makeNode("src/a.ts", "typescript")]);
    const types = getLanguageCoverage(graph).map((c) => c.type);
    expect(types).toEqual(["typescript"]);
    expect(types).not.toContain("python");
    expect(types).not.toContain("go");
  });

  test("returns an empty array for an empty graph", () => {
    expect(getLanguageCoverage(makeGraph([]))).toEqual([]);
  });
});
