import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { branchGraphCacheDir, loadBranchGraph, saveBranchGraph } from "./branch-graph-cache";
import { Graph } from "./model";

describe("branch-graph-cache", { tags: ["branch-graph-cache"] }, () => {
  let rootDir: string | undefined;

  afterEach(() => {
    if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  it("returns null for a sha that was never cached", () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-branch-cache-"));
    expect(loadBranchGraph(rootDir, "deadbeef")).toBeNull();
  });

  it("round-trips a graph through save/load, creating the cache dir as needed", () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-branch-cache-"));
    const graph = Graph.deserialize({
      nodes: [
        {
          path: "src/a.ts",
          type: "typescript",
          category: "logic",
          tags: [],
          imports: [],
          exports: [{ name: "foo" }],
          mtime: 0,
          size: 0,
        },
      ],
    });

    expect(fs.existsSync(branchGraphCacheDir(rootDir))).toBe(false);
    saveBranchGraph(rootDir, "abc123", graph);
    expect(fs.existsSync(branchGraphCacheDir(rootDir))).toBe(true);

    const loaded = loadBranchGraph(rootDir, "abc123");
    expect(loaded).not.toBeNull();
    expect(loaded?.nodes.get("src/a.ts")?.exports).toEqual([{ name: "foo" }]);
  });

  it("keys entries by sha, so different shas don't collide", () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-branch-cache-"));
    const graphA = Graph.deserialize({ nodes: [] });
    const graphB = Graph.deserialize({
      nodes: [
        {
          path: "src/b.ts",
          type: "typescript",
          category: "logic",
          tags: [],
          imports: [],
          exports: [],
          mtime: 0,
          size: 0,
        },
      ],
    });
    saveBranchGraph(rootDir, "sha-a", graphA);
    saveBranchGraph(rootDir, "sha-b", graphB);

    expect(loadBranchGraph(rootDir, "sha-a")?.nodes.size).toBe(0);
    expect(loadBranchGraph(rootDir, "sha-b")?.nodes.size).toBe(1);
  });

  it("returns null for an unreadable/corrupt cache file instead of throwing", () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-branch-cache-"));
    fs.mkdirSync(branchGraphCacheDir(rootDir), { recursive: true });
    fs.writeFileSync(path.join(branchGraphCacheDir(rootDir), "bad.json"), "not json");
    expect(loadBranchGraph(rootDir, "bad")).toBeNull();
  });
});
