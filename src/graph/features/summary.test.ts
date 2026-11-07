import { describe, expect, test } from "vitest";
import { Graph } from "../model";
import { buildFeatureGraph, summarizeFeatureGraph } from "./feature-graph";
import { detectFeatures, summarizeFeatures } from "./index";

/** Builds a node importing each path in `imports` (all internal, resolved). */
function node(path: string, imports: string[] = [], type = "typescript", category = "logic") {
  return {
    path,
    type,
    category,
    tags: [],
    imports: imports.map((toPath) => ({
      toPath,
      rawSpecifier: toPath,
      symbols: [],
      isExternal: false,
    })),
    exports: [],
    mtime: 0,
    size: 0,
  };
}

const leaves = ["l1.ts", "l2.ts", "l3.ts"];

function fixtureGraph(): Graph {
  return Graph.deserialize({
    nodes: [
      node("hubA.ts", leaves),
      node("hubB.ts", ["l1.ts", "l2.ts", "hubA.ts"]),
      node("README.md", ["hubA.ts", "l1.ts", "l2.ts"], "markdown", "other"),
      ...leaves.map((leaf) => node(leaf)),
    ],
  } as never);
}

describe("detectFeatures — markdown exclusion", () => {
  test("markdown files that 'import' many sources are not hubs", () => {
    const hubs = detectFeatures(fixtureGraph().nodes, { minOutDegree: 3 });
    expect(Array.from(hubs.keys()).sort()).toEqual(["hubA.ts", "hubB.ts"]);
  });
});

describe("summarizeFeatures", () => {
  const features = Array.from({ length: 5 }, (_, index) => ({
    path: `f${index}.ts`,
    outDegree: 10 - index,
    tag: `feature:f${index}`,
  }));

  test("under the limit: no truncation fields, true total reported", () => {
    const result = summarizeFeatures(features, { limit: 10 });
    expect(result.count).toBe(5);
    expect(result.matched).toBe(5);
    expect(result.truncated).toBeUndefined();
    expect(result.hint).toBeUndefined();
  });

  test("over the limit: keeps the head, reports matched, adds truncated + hint", () => {
    const result = summarizeFeatures(features, { limit: 2 });
    expect(result.features.map((feature) => feature.path)).toEqual(["f0.ts", "f1.ts"]);
    expect(result.count).toBe(2);
    expect(result.matched).toBe(5);
    expect(result.truncated).toBe(true);
    expect(result.hint).toMatch(/limit/);
  });

  test.each([undefined, 0, -3, Number.NaN])("limit %s falls back to the default", (limit) => {
    expect(summarizeFeatures(features, { limit }).count).toBe(5);
  });
});

describe("summarizeFeatureGraph", () => {
  test("reports counts per feature and no file lists", () => {
    const summary = summarizeFeatureGraph(buildFeatureGraph(fixtureGraph(), { minOutDegree: 3 }));
    expect(summary.totalFeatures).toBe(2);
    expect(summary.features.hubA).toEqual({ hub: "hubA.ts", outDegree: 3, fileCount: 3 });
    expect(JSON.stringify(summary)).not.toContain("l3.ts");
    expect(summary.truncated).toBeUndefined();
    expect(summary.hint).toMatch(/feature/);
  });

  test("limit keeps the features owning the most files and flags truncation", () => {
    const full = buildFeatureGraph(fixtureGraph(), { minOutDegree: 3 });
    const summary = summarizeFeatureGraph(full, { limit: 1 });
    expect(Object.keys(summary.features)).toEqual(["hubA"]);
    expect(summary.totalFeatures).toBe(2);
    expect(summary.truncated).toBe(true);
  });

  test("unassignedCount matches the full graph", () => {
    const full = buildFeatureGraph(fixtureGraph(), { minOutDegree: 3 });
    expect(summarizeFeatureGraph(full).unassignedCount).toBe(full.unassigned.length);
  });
});
