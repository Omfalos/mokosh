import { describe, expect, test, vi } from "vitest";
import { Graph } from "../graph/model";
import type { SessionState } from "./cache";
import {
  handleApplyTags,
  handleDetectFeatures,
  handleGetFeatureGraph,
  handleGetTypeGraph,
} from "./handlers";

const applyTagsMock = vi.hoisted(() => vi.fn());
vi.mock("../index", async (importActual) => ({
  ...(await importActual<typeof import("../index")>()),
  applyTags: applyTagsMock,
}));

const ROOT = "/tmp/mokosh-bounded";

function tsNode(
  path: string,
  imports: string[] = [],
  exports: Array<{ name: string; signature?: string; doc?: string }> = [],
) {
  return {
    path,
    type: "typescript",
    category: "logic",
    tags: [],
    imports: imports.map((toPath) => ({
      toPath,
      rawSpecifier: toPath,
      symbols: [],
      isExternal: false,
    })),
    exports,
    mtime: 0,
    size: 0,
  };
}

/** 4 hubs (h0..h3, out-degree 5..8), each importing its own leaves, plus 2 exported interfaces. */
function makeGraph(): Graph {
  const nodes = [];
  for (let hub = 0; hub < 4; hub++) {
    const leaves = Array.from({ length: 5 + hub }, (_, leaf) => `leaf-${hub}-${leaf}.ts`);
    nodes.push(tsNode(`h${hub}.ts`, leaves));
    for (const leaf of leaves) {
      nodes.push(
        tsNode(
          leaf,
          [],
          [{ name: `T_${leaf}`, signature: "interface X", doc: "Doc.\nMore detail." }],
        ),
      );
    }
  }
  return Graph.deserialize({ nodes } as never);
}

function makeCache(): SessionState {
  const graph = makeGraph();
  return {
    resolveGraphs: vi.fn().mockResolvedValue([{ graph, package: "root" }]),
    resolveFlatGraph: vi.fn().mockResolvedValue({ graph, packageOf: new Map() }),
  } as unknown as SessionState;
}

// biome-ignore lint/suspicious/noExplicitAny: tests index into several different response shapes
function parse(result: { content: Array<{ type: string; text: string }> }): any {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("handleDetectFeatures — limit", () => {
  test("caps the list, keeps the true total, and sorts by out-degree", async () => {
    const data = parse(await handleDetectFeatures(makeCache(), { root: ROOT, limit: 2 }));
    expect(data.features.map((feature: { path: string }) => feature.path)).toEqual([
      "h3.ts",
      "h2.ts",
    ]);
    expect(data.count).toBe(2);
    expect(data.matched).toBe(4);
    expect(data.truncated).toBe(true);
  });

  test("a small result is not marked truncated", async () => {
    const data = parse(await handleDetectFeatures(makeCache(), { root: ROOT }));
    expect(data.count).toBe(data.matched);
    expect(data.truncated).toBeUndefined();
  });
});

describe("handleGetFeatureGraph — views", () => {
  test("default is the counts-only summary", async () => {
    const data = parse(await handleGetFeatureGraph(makeCache(), { root: ROOT }));
    expect(data.totalFeatures).toBe(4);
    expect(data.features.h3).toMatchObject({ hub: "h3.ts", outDegree: 8, fileCount: 8 });
    expect(data.unassignedCount).toBe(0);
    expect(data.unassigned).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("leaf-3-0.ts");
  });

  test('view:"full" restores every file and the unassigned list', async () => {
    const data = parse(await handleGetFeatureGraph(makeCache(), { root: ROOT, view: "full" }));
    expect(data.features.h0.files).toHaveLength(5);
    expect(Array.isArray(data.unassigned)).toBe(true);
  });

  test("feature returns that one domain's files", async () => {
    const data = parse(await handleGetFeatureGraph(makeCache(), { root: ROOT, feature: "h1" }));
    expect(data.feature).toBe("h1");
    expect(data.fileCount).toBe(6);
    expect(data.files).toContain("leaf-1-0.ts");
  });

  test("an unknown feature says so instead of throwing", async () => {
    const data = parse(await handleGetFeatureGraph(makeCache(), { root: ROOT, feature: "nope" }));
    expect(data.found).toBe(false);
  });
});

describe("handleGetTypeGraph — inventory", () => {
  test("limit/kind bound the inventory and docs are first-line only", async () => {
    const data = parse(
      await handleGetTypeGraph(makeCache(), { root: ROOT, limit: 3, kind: "interface" }),
    );
    expect(data.count).toBe(3);
    expect(data.matched).toBe(26);
    expect(data.byKind).toEqual({ interface: 26 });
    expect(data.truncated).toBe(true);
    expect(data.types[0].doc).toBe("Doc.");
  });

  test("path filter narrows the matches", async () => {
    const data = parse(await handleGetTypeGraph(makeCache(), { root: ROOT, path: "leaf-0-" }));
    expect(data.matched).toBe(5);
  });
});

describe("handleApplyTags — default summary vs verbose", () => {
  const files = [
    ...Array.from({ length: 30 }, (_, i) => ({ path: `u${i}.test.ts`, status: "updated" })),
    ...Array.from({ length: 100 }, (_, i) => ({ path: `n${i}.test.ts`, status: "unchanged" })),
  ];

  test("default response is bounded and echoes dryRun", async () => {
    applyTagsMock.mockResolvedValue({ updated: 30, unchanged: 100, errors: 0, files });
    const data = parse(await handleApplyTags(makeCache(), { root: ROOT, dryRun: true }));
    expect(data).toMatchObject({
      dryRun: true,
      updated: 30,
      unchanged: 100,
      errors: 0,
      moreUpdated: 10,
    });
    expect(data.files).toHaveLength(20);
    expect(applyTagsMock).toHaveBeenCalledWith(expect.anything(), ROOT, { dryRun: true });
  });

  test("verbose returns the full per-file list", async () => {
    applyTagsMock.mockResolvedValue({ updated: 30, unchanged: 100, errors: 0, files });
    const data = parse(
      await handleApplyTags(makeCache(), { root: ROOT, dryRun: true, verbose: true }),
    );
    expect(data.files).toHaveLength(130);
  });
});
