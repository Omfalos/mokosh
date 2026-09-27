import { describe, expect, it } from "vitest";
import type { CallEdge, FileNode, ImportEdge } from "../../types/node";
import { Graph } from "../model";
import {
  applyStaticCoverage,
  computeStaticCoverage,
  STATIC_COVERAGE_TIERS,
} from "./static-estimate";

function imp(toPath: string): ImportEdge {
  return {
    fromPath: "",
    toPath,
    rawSpecifier: toPath,
    type: "static",
    isStyle: false,
    isExternal: false,
  };
}

function call(from: string, to: string, toFile: string): CallEdge {
  return { from, to, toFile };
}

function node(overrides: Partial<FileNode> & { path: string }): FileNode {
  return {
    type: "typescript",
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
    ...overrides,
  };
}

function graphOf(nodes: FileNode[]): Graph {
  return new Graph(new Map(nodes.map((n) => [n.path, n])));
}

describe("computeStaticCoverage", () => {
  it("returns an empty map when there are no test files", () => {
    const graph = graphOf([node({ path: "src/a.ts" })]);
    expect(computeStaticCoverage(graph).size).toBe(0);
  });

  it("scores test files themselves as DIRECT", () => {
    const graph = graphOf([node({ path: "src/a.test.ts", category: "test" })]);
    expect(computeStaticCoverage(graph).get("src/a.test.ts")).toBe(STATIC_COVERAGE_TIERS.DIRECT);
  });

  it("scores a directly-imported file as DIRECT via testedBy", () => {
    const graph = graphOf([
      node({
        path: "src/a.test.ts",
        category: "test",
        imports: [imp("src/a.ts")],
      }),
      node({ path: "src/a.ts", testedBy: ["src/a.test.ts"] }),
    ]);
    expect(computeStaticCoverage(graph).get("src/a.ts")).toBe(STATIC_COVERAGE_TIERS.DIRECT);
  });

  it("scores a one-hop call target as DIRECT even without testedBy", () => {
    const graph = graphOf([
      node({
        path: "src/a.test.ts",
        category: "test",
        callEdges: [call("run", "helper", "src/helper.ts")],
      }),
      node({ path: "src/helper.ts" }),
    ]);
    expect(computeStaticCoverage(graph).get("src/helper.ts")).toBe(STATIC_COVERAGE_TIERS.DIRECT);
  });

  it("scores a transitively call-reachable file as CALL_REACHABLE", () => {
    const graph = graphOf([
      node({
        path: "src/a.test.ts",
        category: "test",
        callEdges: [call("run", "mid", "src/mid.ts")],
      }),
      node({
        path: "src/mid.ts",
        callEdges: [call("mid", "deep", "src/deep.ts")],
      }),
      node({ path: "src/deep.ts" }),
    ]);
    const result = computeStaticCoverage(graph);
    expect(result.get("src/mid.ts")).toBe(STATIC_COVERAGE_TIERS.DIRECT);
    expect(result.get("src/deep.ts")).toBe(STATIC_COVERAGE_TIERS.CALL_REACHABLE);
  });

  it("scores an import-only reachable file as IMPORT_REACHABLE", () => {
    const graph = graphOf([
      node({
        path: "src/a.test.ts",
        category: "test",
        imports: [imp("src/a.ts")],
      }),
      node({ path: "src/a.ts" }), // imported, but no testedBy/call edge recorded
    ]);
    expect(computeStaticCoverage(graph).get("src/a.ts")).toBe(
      STATIC_COVERAGE_TIERS.IMPORT_REACHABLE,
    );
  });

  it("scores an unreached file as UNREACHED", () => {
    const graph = graphOf([
      node({ path: "src/a.test.ts", category: "test" }),
      node({ path: "src/orphan.ts" }),
    ]);
    expect(computeStaticCoverage(graph).get("src/orphan.ts")).toBe(STATIC_COVERAGE_TIERS.UNREACHED);
  });
});

describe("applyStaticCoverage", () => {
  it("mutates graph nodes in place and tags them coverageSource: static", () => {
    const graph = graphOf([
      node({ path: "src/a.test.ts", category: "test", imports: [imp("src/a.ts")] }),
      node({ path: "src/a.ts", testedBy: ["src/a.test.ts"] }),
      node({ path: "src/orphan.ts" }),
    ]);
    applyStaticCoverage(graph);
    expect(graph.nodes.get("src/a.ts")?.coveragePct).toBe(STATIC_COVERAGE_TIERS.DIRECT);
    expect(graph.nodes.get("src/a.ts")?.coverageSource).toBe("static");
    expect(graph.nodes.get("src/orphan.ts")?.coveragePct).toBe(STATIC_COVERAGE_TIERS.UNREACHED);
    expect(graph.nodes.get("src/orphan.ts")?.coverageSource).toBe("static");
  });

  it("is a no-op when there are no test files", () => {
    const graph = graphOf([node({ path: "src/a.ts" })]);
    applyStaticCoverage(graph);
    expect(graph.nodes.get("src/a.ts")?.coveragePct).toBeUndefined();
  });
});
