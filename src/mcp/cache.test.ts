import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createImportMap, createWorkspaceGraph, Graph, WorkspaceGraph } from "../index";
import type { FileNode } from "../types/node";
import { SessionState } from "./cache";

// Wraps `createImportMap` so tests can inspect call args (e.g. whether a disk-cache seed was
// passed as `previousGraph`) without losing real graph-building behavior — every call still runs
// through the actual implementation. `createWorkspaceGraph` is fully mocked instead: exercising
// real monorepo detection isn't what these tests are about, and a hand-built `WorkspaceGraph` is
// far simpler and more deterministic than a real workspace fixture.
vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return {
    ...actual,
    createImportMap: vi.fn(actual.createImportMap),
    createWorkspaceGraph: vi.fn(),
  };
});

/** Reaches into `SessionState`'s private `dirtyRoots` set to simulate a file-watcher-detected
 *  change deterministically — real `fs.watch` timing isn't reliable in tests. */
function markDirty(state: SessionState, root: string): void {
  (state as unknown as { dirtyRoots: Set<string> }).dirtyRoots.add(root);
}

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

function makeWorkspaceGraph(root: string, nodes: FileNode[]): WorkspaceGraph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  const wg = new WorkspaceGraph(root, "npm");
  wg.addPackage({ name: "root", root, relativeRoot: "", entryPoints: [] }, new Graph(map));
  return wg;
}

describe("SessionState", {
  tags: ["SessionState", "cache", "mcp", "ChangeImpactCache", "createImportMap"],
}, () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-session-state-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    vi.mocked(createImportMap).mockClear();
    vi.mocked(createWorkspaceGraph).mockReset();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("getLastEntryPoints", () => {
    test("returns undefined before any analyze call", () => {
      const state = new SessionState();
      expect(state.getLastEntryPoints(root)).toBeUndefined();
    });

    test("returns the stored single-package entry points", () => {
      const state = new SessionState();
      state.storeLastAnalyze(root, {
        kind: "single",
        entryPoints: [`${root}/src/a.ts`],
        coverageMap: new Map(),
      });
      expect(state.getLastEntryPoints(root)).toEqual([`${root}/src/a.ts`]);
    });

    test("returns undefined for a workspace root", () => {
      const state = new SessionState();
      state.storeLastAnalyze(root, { kind: "workspace" });
      expect(state.getLastEntryPoints(root)).toBeUndefined();
    });
  });

  describe("getOrBuildChangeImpact / dirty-root invalidation", () => {
    test("builds lazily and reuses the same object across repeated calls", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const state = new SessionState();
      await state.getOrBuild(root, ["src/a.ts"]);

      const first = state.getOrBuildChangeImpact(root);
      const second = state.getOrBuildChangeImpact(root);

      expect(second).toBe(first);
    });

    test("ensureFresh drops the stale ChangeImpactCache on a dirty root, so the next lookup reflects the rebuilt graph", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      fs.writeFileSync(path.join(root, "src", "b.ts"), "export const b = 1;");
      const state = new SessionState();
      await state.getOrBuild(root, ["src/a.ts", "src/b.ts"]);
      state.storeLastAnalyze(root, {
        kind: "single",
        entryPoints: ["src/a.ts", "src/b.ts"],
        coverageMap: new Map(),
      });

      const before = state.getOrBuildChangeImpact(root);
      expect(before.impact.get("src/a.ts")).toEqual([]);

      // b.ts starts importing a.ts — a real edit a watcher would pick up.
      fs.writeFileSync(path.join(root, "src", "b.ts"), "import './a';\nexport const b = 2;");
      markDirty(state, root);

      await state.ensureFresh(root);
      const after = state.getOrBuildChangeImpact(root);

      expect(after).not.toBe(before);
      expect(after.impact.get("src/a.ts")).toContain("src/b.ts");
    });

    test("ensureFreshWorkspace drops any stale ChangeImpactCache entry on a dirty workspace root", async () => {
      // `changeImpactCaches` is keyed by root regardless of single-package vs. workspace mode —
      // `ensureFreshWorkspace` clears it defensively on every dirty rebuild so a root can never
      // serve a stale entry left over from before it was re-analyzed, whichever mode wrote it.
      const before = makeWorkspaceGraph(root, [makeNode("src/a.ts")]);
      const after = makeWorkspaceGraph(root, [
        makeNode("src/a.ts"),
        makeNode("src/b.ts", ["src/a.ts"]),
      ]);
      vi.mocked(createWorkspaceGraph).mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const state = new SessionState();
      await state.getOrBuildWorkspace(root);
      state.storeLastAnalyze(root, { kind: "workspace" });

      const changeImpactCaches = (state as unknown as { changeImpactCaches: Map<string, unknown> })
        .changeImpactCaches;
      const staleEntry = { impact: new Map(), graphHash: "stale" };
      changeImpactCaches.set(root, staleEntry);

      markDirty(state, root);
      await state.ensureFreshWorkspace(root);

      expect(changeImpactCaches.has(root)).toBe(false);
      expect(vi.mocked(createWorkspaceGraph)).toHaveBeenCalledTimes(2);
    });

    test("invalidate clears the ChangeImpactCache along with the graph, instead of leaving it servable", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const state = new SessionState();
      await state.getOrBuild(root, ["src/a.ts"]);
      state.getOrBuildChangeImpact(root);

      state.invalidate(root);

      expect(() => state.getOrBuildChangeImpact(root)).toThrow(/Call "analyze" first/);
    });

    test("invalidate clears the stored config, so a config edited mid-session is re-read on the next analyze", () => {
      const state = new SessionState();
      state.storeConfig(root, { testPatterns: [".steps."] });
      expect(state.isConfigured(root)).toBe(true);

      state.invalidate(root);

      expect(state.isConfigured(root)).toBe(false);
      expect(state.getConfig(root)).toBeUndefined();
    });
  });

  describe("getOrBuild disk-cache seeding", () => {
    function graphCachePath(): string {
      return path.join(root, "mokosh-cache", "graph.json");
    }

    test("does not seed when no disk cache exists (baseline, unchanged behavior)", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const state = new SessionState();

      await state.getOrBuild(root, ["src/a.ts"]);

      expect(vi.mocked(createImportMap)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createImportMap).mock.calls[0]?.[2]).toBeNull();
    });

    test("seeds the first build of a session from a CLI-written on-disk graph cache", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const seedGraph = await createImportMap(root, ["src/a.ts"]);
      fs.mkdirSync(path.dirname(graphCachePath()), { recursive: true });
      fs.writeFileSync(graphCachePath(), JSON.stringify(seedGraph.serialize()));
      vi.mocked(createImportMap).mockClear();

      const state = new SessionState();
      await state.getOrBuild(root, ["src/a.ts"]);

      const previousGraphArg = vi.mocked(createImportMap).mock.calls[0]?.[2];
      expect(previousGraphArg).not.toBeNull();
      expect(previousGraphArg?.serialize().nodes.map((n) => n.path)).toContain("src/a.ts");
    });

    test("only seeds from disk on the session's first call for a root — later calls reuse the in-memory graph", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const seedGraph = await createImportMap(root, ["src/a.ts"]);
      fs.mkdirSync(path.dirname(graphCachePath()), { recursive: true });
      fs.writeFileSync(graphCachePath(), JSON.stringify(seedGraph.serialize()));
      vi.mocked(createImportMap).mockClear();

      const state = new SessionState();
      const firstGraph = await state.getOrBuild(root, ["src/a.ts"]);
      await state.getOrBuild(root, ["src/a.ts"]);

      const secondCallPreviousGraph = vi.mocked(createImportMap).mock.calls[1]?.[2];
      expect(secondCallPreviousGraph).toBe(firstGraph);
    });

    test("degrades to a fresh build instead of throwing when the disk cache is corrupt", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      fs.mkdirSync(path.dirname(graphCachePath()), { recursive: true });
      fs.writeFileSync(graphCachePath(), "not json {{{");

      const state = new SessionState();
      const graph = await state.getOrBuild(root, ["src/a.ts"]);

      expect(graph.serialize().nodes.map((n) => n.path)).toContain("src/a.ts");
      expect(vi.mocked(createImportMap).mock.calls[0]?.[2]).toBeNull();
    });

    test("honors a config.cachePath override instead of the default mokosh-cache/graph.json", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const seedGraph = await createImportMap(root, ["src/a.ts"]);
      const customPath = path.join(root, "custom-cache.json");
      fs.writeFileSync(customPath, JSON.stringify(seedGraph.serialize()));
      vi.mocked(createImportMap).mockClear();

      const state = new SessionState();
      state.storeConfig(root, { cachePath: "custom-cache.json" });
      await state.getOrBuild(root, ["src/a.ts"]);

      const previousGraphArg = vi.mocked(createImportMap).mock.calls[0]?.[2];
      expect(previousGraphArg).not.toBeNull();
      expect(previousGraphArg?.serialize().nodes.map((n) => n.path)).toContain("src/a.ts");
    });
  });
});
