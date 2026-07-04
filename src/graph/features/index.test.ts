import { describe, expect, test } from "vitest";
import type { FileNode } from "../../types/node";
import { detectFeatures } from "./index";

function makeNodeWithImports(
  p: string,
  category: FileNode["category"] = "logic",
  importTargets: string[] = [],
  external = false,
): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    imports: importTargets.map((target) => ({
      fromPath: p,
      toPath: target,
      rawSpecifier: `./${target}`,
      type: "static" as const,
      isStyle: false,
      isExternal: external,
    })),
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
}

function makeGraphWithOutDegree(
  filePath: string,
  category: FileNode["category"],
  importCount: number,
  external = false,
): Map<string, FileNode> {
  const targets = Array.from({ length: importCount }, (_, i) => `dep${i}.ts`);
  const nodes = new Map<string, FileNode>();
  nodes.set(filePath, makeNodeWithImports(filePath, category, targets, external));
  for (const t of targets) {
    nodes.set(t, makeNodeWithImports(t));
  }
  return nodes;
}

describe("detectFeatures", { tags: ["FileNode", "detectFeatures", "node"] }, () => {
  test("returns empty map for empty graph", () => {
    expect(detectFeatures(new Map())).toEqual(new Map());
  });

  test("returns empty map when no file meets the threshold", () => {
    const nodes = makeGraphWithOutDegree("feature.ts", "logic", 4);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.size).toBe(0);
  });

  test("includes file at exactly minOutDegree imports", () => {
    const nodes = makeGraphWithOutDegree("feature.ts", "logic", 5);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.has("feature.ts")).toBe(true);
    expect(result.get("feature.ts")?.outDegree).toBe(5);
  });

  test("excludes file one below minOutDegree", () => {
    const nodes = makeGraphWithOutDegree("feature.ts", "logic", 4);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.has("feature.ts")).toBe(false);
  });

  test("excludes test files even if high out-degree", () => {
    const nodes = makeGraphWithOutDegree("auth.test.ts", "test", 10);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.has("auth.test.ts")).toBe(false);
  });

  test("tag format strips extension and adds feature: prefix", () => {
    const nodes = makeGraphWithOutDegree("src/utils.ts", "logic", 5);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.get("src/utils.ts")?.tag).toBe("feature:utils");
  });

  test("excludes barrel files even if high out-degree", () => {
    const nodes = makeGraphWithOutDegree("src/graph/index.ts", "barrel", 6);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.has("src/graph/index.ts")).toBe(false);
  });

  test("defaults to minOutDegree of 5", () => {
    const nodes4 = makeGraphWithOutDegree("feature.ts", "logic", 4);
    expect(detectFeatures(nodes4).size).toBe(0);

    const nodes5 = makeGraphWithOutDegree("feature.ts", "logic", 5);
    expect(detectFeatures(nodes5).size).toBe(1);
  });

  test("excludes external imports from out-degree count", () => {
    const nodes = makeGraphWithOutDegree("feature.ts", "logic", 6, true);
    const result = detectFeatures(nodes, { minOutDegree: 5 });
    expect(result.has("feature.ts")).toBe(false);
  });
});
