import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import {
  buildChangeImpactCache,
  type ChangeImpactCache,
  computeGraphHash,
  isChangeImpactCacheValid,
  loadChangeImpactCache,
  queryChangeImpact,
  saveChangeImpactCache,
} from "./change-impact-cache";
import { Graph } from "./model";

function makeNode(p: string, importTargets: string[] = []): FileNode {
  return {
    path: p,
    type: "typescript",
    category: "logic",
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
    mtime: 1000,
    size: 100,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("buildChangeImpactCache", () => {
  test("returns empty impact map for empty graph", () => {
    const cache = buildChangeImpactCache(new Graph(new Map()));
    expect(cache.impact.size).toBe(0);
  });

  test("file with no dependents has empty impact list", () => {
    const graph = makeGraph([makeNode("src/leaf.ts")]);
    const cache = buildChangeImpactCache(graph);
    expect(queryChangeImpact(cache, "src/leaf.ts")).toHaveLength(0);
  });

  test("direct dependent is in impact list", () => {
    // a → b means b imports a; changing a affects b
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts", ["src/a.ts"])]);
    const cache = buildChangeImpactCache(graph);
    expect(queryChangeImpact(cache, "src/a.ts")).toContain("src/b.ts");
  });

  test("transitive dependents are included", () => {
    // c imports b, b imports a — changing a affects both b and c
    const graph = makeGraph([
      makeNode("src/a.ts"),
      makeNode("src/b.ts", ["src/a.ts"]),
      makeNode("src/c.ts", ["src/b.ts"]),
    ]);
    const cache = buildChangeImpactCache(graph);
    const affected = queryChangeImpact(cache, "src/a.ts");
    expect(affected).toContain("src/b.ts");
    expect(affected).toContain("src/c.ts");
  });

  test("changing a leaf does not affect the files it imports", () => {
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts", ["src/a.ts"])]);
    const cache = buildChangeImpactCache(graph);
    // b imports a, but changing a does not affect a itself
    expect(queryChangeImpact(cache, "src/b.ts")).not.toContain("src/a.ts");
  });

  test("every graph node has an entry in the cache", () => {
    const graph = makeGraph([
      makeNode("src/a.ts"),
      makeNode("src/b.ts", ["src/a.ts"]),
      makeNode("src/c.ts"),
    ]);
    const cache = buildChangeImpactCache(graph);
    expect(cache.impact.has("src/a.ts")).toBe(true);
    expect(cache.impact.has("src/b.ts")).toBe(true);
    expect(cache.impact.has("src/c.ts")).toBe(true);
  });

  test("cache includes a non-empty graphHash", () => {
    const graph = makeGraph([makeNode("src/a.ts")]);
    const cache = buildChangeImpactCache(graph);
    expect(cache.graphHash).toBeTruthy();
    expect(cache.graphHash.length).toBeGreaterThan(0);
  });
});

describe("queryChangeImpact", () => {
  test("returns empty array for unknown file", () => {
    const cache = buildChangeImpactCache(new Graph(new Map()));
    expect(queryChangeImpact(cache, "src/missing.ts")).toEqual([]);
  });
});

describe("computeGraphHash", () => {
  test("same graph produces same hash", () => {
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts", ["src/a.ts"])]);
    expect(computeGraphHash(graph)).toBe(computeGraphHash(graph));
  });

  test("different node mtime produces different hash", () => {
    const graph1 = makeGraph([makeNode("src/a.ts")]);
    const node = makeNode("src/a.ts");
    node.mtime = 9999;
    const graph2 = makeGraph([node]);
    expect(computeGraphHash(graph1)).not.toBe(computeGraphHash(graph2));
  });

  test("different node count produces different hash", () => {
    const graph1 = makeGraph([makeNode("src/a.ts")]);
    const graph2 = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts")]);
    expect(computeGraphHash(graph1)).not.toBe(computeGraphHash(graph2));
  });

  test("empty graph has a stable hash", () => {
    const g1 = new Graph(new Map());
    const g2 = new Graph(new Map());
    expect(computeGraphHash(g1)).toBe(computeGraphHash(g2));
  });
});

describe("isChangeImpactCacheValid", () => {
  test("returns true when graph has not changed", () => {
    const graph = makeGraph([makeNode("src/a.ts")]);
    const cache = buildChangeImpactCache(graph);
    expect(isChangeImpactCacheValid(cache, graph)).toBe(true);
  });

  test("returns false when a node mtime changes", () => {
    const graph = makeGraph([makeNode("src/a.ts")]);
    const cache = buildChangeImpactCache(graph);
    const node = makeNode("src/a.ts");
    node.mtime = 99999;
    const newGraph = makeGraph([node]);
    expect(isChangeImpactCacheValid(cache, newGraph)).toBe(false);
  });

  test("returns false when a node is added", () => {
    const graph = makeGraph([makeNode("src/a.ts")]);
    const cache = buildChangeImpactCache(graph);
    const newGraph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts")]);
    expect(isChangeImpactCacheValid(cache, newGraph)).toBe(false);
  });
});

describe("saveChangeImpactCache + loadChangeImpactCache", () => {
  test("round-trips impact map and graphHash", () => {
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts", ["src/a.ts"])]);
    const cache = buildChangeImpactCache(graph);
    const tmpPath = path.join(os.tmpdir(), `mokosh-test-${Date.now()}.json`);
    try {
      saveChangeImpactCache(cache, tmpPath);
      const loaded = loadChangeImpactCache(tmpPath);
      expect(loaded).not.toBeNull();
      expect(loaded?.graphHash).toBe(cache.graphHash);
      expect(loaded?.impact.get("src/a.ts")).toEqual(cache.impact.get("src/a.ts"));
      expect(loaded?.impact.get("src/b.ts")).toEqual(cache.impact.get("src/b.ts"));
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  test("loadChangeImpactCache returns null for missing file", () => {
    expect(loadChangeImpactCache("/nonexistent/path/cache.json")).toBeNull();
  });

  test("loadChangeImpactCache returns null for malformed JSON", () => {
    const tmpPath = path.join(os.tmpdir(), `mokosh-bad-${Date.now()}.json`);
    try {
      fs.writeFileSync(tmpPath, "not json {{{");
      expect(loadChangeImpactCache(tmpPath)).toBeNull();
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  test("saved cache passes isChangeImpactCacheValid on the same graph", () => {
    const graph = makeGraph([makeNode("src/a.ts"), makeNode("src/b.ts")]);
    const cache = buildChangeImpactCache(graph);
    const tmpPath = path.join(os.tmpdir(), `mokosh-valid-${Date.now()}.json`);
    try {
      saveChangeImpactCache(cache, tmpPath);
      const loaded = loadChangeImpactCache(tmpPath) as ChangeImpactCache;
      expect(isChangeImpactCacheValid(loaded, graph)).toBe(true);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });
});
