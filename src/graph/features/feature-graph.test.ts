import { describe, expect, test } from "vitest";
import type { FileNode } from "../../types/node";
import { Graph } from "../model";
import { buildFeatureGraph, type FeatureDomain } from "./feature-graph";

function makeNode(
  p: string,
  category: FileNode["category"] = "logic",
  importTargets: string[] = [],
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
      isExternal: false,
    })),
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

describe("buildFeatureGraph", {
  tags: [
    "FeatureDomain",
    "FileNode",
    "Graph",
    "buildFeatureGraph",
    "feature-graph",
    "model",
    "node",
  ],
}, () => {
  test("returns empty features and all nodes unassigned when no hub meets threshold", () => {
    const graph = makeGraph([makeNode("src/a.ts", "logic", ["src/b.ts"]), makeNode("src/b.ts")]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.features.size).toBe(0);
    expect(result.unassigned).toContain("src/a.ts");
    expect(result.unassigned).toContain("src/b.ts");
  });

  test("groups transitive deps under the hub", () => {
    // hub imports a, b, c, d, e (5 deps)
    const hub = makeNode("src/hub.ts", "logic", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.features.has("hub")).toBe(true);
    const domain = result.features.get("hub") as FeatureDomain;
    expect(domain.hub).toBe("src/hub.ts");
    expect(domain.files).toHaveLength(5);
    expect(domain.files).toContain("src/a.ts");
    expect(result.unassigned).toHaveLength(0);
  });

  test("assigns file to lowest-outDegree hub (most specific)", () => {
    // hubA (outDegree 6) and hubB (outDegree 5) both reach "src/shared.ts"
    // shared.ts should go to hubB (lower outDegree = more specific)
    const hubA = makeNode("src/hubA.ts", "logic", [
      "src/a1.ts",
      "src/a2.ts",
      "src/a3.ts",
      "src/a4.ts",
      "src/shared.ts",
      "src/hubB.ts",
    ]);
    const hubB = makeNode("src/hubB.ts", "logic", [
      "src/b1.ts",
      "src/b2.ts",
      "src/b3.ts",
      "src/b4.ts",
      "src/shared.ts",
    ]);
    const graph = makeGraph([
      hubA,
      hubB,
      makeNode("src/a1.ts"),
      makeNode("src/a2.ts"),
      makeNode("src/a3.ts"),
      makeNode("src/a4.ts"),
      makeNode("src/b1.ts"),
      makeNode("src/b2.ts"),
      makeNode("src/b3.ts"),
      makeNode("src/b4.ts"),
      makeNode("src/shared.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    const domainA = result.features.get("hubA") as FeatureDomain;
    const domainB = result.features.get("hubB") as FeatureDomain;
    expect(domainB.files).toContain("src/shared.ts");
    expect(domainA.files).not.toContain("src/shared.ts");
  });

  test("hub files are not listed inside their own domain files", () => {
    const hub = makeNode("src/hub.ts", "logic", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    const domain = result.features.get("hub") as FeatureDomain;
    expect(domain.files).not.toContain("src/hub.ts");
  });

  test("test and barrel categories are not promoted to hubs", () => {
    const testHub = makeNode("src/hub.test.ts", "test", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const barrelHub = makeNode("src/index.ts", "barrel", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const graph = makeGraph([
      testHub,
      barrelHub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.features.size).toBe(0);
    expect(result.unassigned).toContain("src/index.ts");
    expect(result.unassigned).toContain("src/hub.test.ts");
  });

  test("feature name for index files uses parent directory name", () => {
    const hub = makeNode("src/graph/index.ts", "logic", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.features.has("graph")).toBe(true);
  });

  test("unassigned contains files not reachable from any hub", () => {
    const hub = makeNode("src/hub.ts", "logic", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
    ]);
    const orphan = makeNode("src/orphan.ts");
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
      orphan,
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.unassigned).toContain("src/orphan.ts");
    expect(result.unassigned).toHaveLength(1);
  });

  test("outDegree on domain matches hub out-degree", () => {
    const hub = makeNode("src/hub.ts", "logic", [
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts",
      "src/f.ts",
    ]);
    const graph = makeGraph([
      hub,
      makeNode("src/a.ts"),
      makeNode("src/b.ts"),
      makeNode("src/c.ts"),
      makeNode("src/d.ts"),
      makeNode("src/e.ts"),
      makeNode("src/f.ts"),
    ]);
    const result = buildFeatureGraph(graph, { minOutDegree: 5 });
    expect(result.features.get("hub")?.outDegree).toBe(6);
  });
});
