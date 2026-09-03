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

  describe("workspace layout memoization + in-flight build sharing", () => {
    test("getLayout runs detectMonorepo once per root", () => {
      const state = new SessionState();
      const first = state.getLayout(root);
      const second = state.getLayout(root);
      expect(second).toBe(first); // same object reference → not re-detected
    });

    test("invalidate forces the layout to be re-detected", () => {
      const state = new SessionState();
      const first = state.getLayout(root);
      state.invalidate(root);
      expect(state.getLayout(root)).not.toBe(first);
    });

    test("persists the workspace graph to disk and hydrates a fresh session when the digest matches", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      const wg = makeWorkspaceGraph(root, [makeNode("src/a.ts")]);
      vi.mocked(createWorkspaceGraph).mockResolvedValue(wg);

      const session1 = new SessionState();
      await session1.getOrBuildWorkspace(root);
      expect(fs.existsSync(path.join(root, "mokosh-cache", "workspace-graph.json"))).toBe(true);

      vi.mocked(createWorkspaceGraph).mockClear();
      const session2 = new SessionState();
      const hydrated = await session2.getOrBuildWorkspace(root);

      expect(vi.mocked(createWorkspaceGraph)).not.toHaveBeenCalled();
      expect([...hydrated.packages.keys()]).toEqual([...wg.packages.keys()]);
    });

    test("rebuilds instead of hydrating once a source file changes", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      vi.mocked(createWorkspaceGraph).mockResolvedValue(
        makeWorkspaceGraph(root, [makeNode("src/a.ts")]),
      );
      await new SessionState().getOrBuildWorkspace(root);

      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 2; // changed");
      vi.mocked(createWorkspaceGraph).mockClear();
      vi.mocked(createWorkspaceGraph).mockResolvedValue(
        makeWorkspaceGraph(root, [makeNode("src/a.ts")]),
      );
      await new SessionState().getOrBuildWorkspace(root);

      expect(vi.mocked(createWorkspaceGraph)).toHaveBeenCalledTimes(1);
    });

    test("forceFresh bypasses a valid disk cache", async () => {
      fs.writeFileSync(path.join(root, "src", "a.ts"), "export const a = 1;");
      vi.mocked(createWorkspaceGraph).mockResolvedValue(
        makeWorkspaceGraph(root, [makeNode("src/a.ts")]),
      );
      await new SessionState().getOrBuildWorkspace(root);

      vi.mocked(createWorkspaceGraph).mockClear();
      vi.mocked(createWorkspaceGraph).mockResolvedValue(
        makeWorkspaceGraph(root, [makeNode("src/a.ts")]),
      );
      await new SessionState().getOrBuildWorkspace(root, { forceFresh: true });

      expect(vi.mocked(createWorkspaceGraph)).toHaveBeenCalledTimes(1);
    });

    test("getOrBuildWorkspace shares one build across concurrent callers and passes the memoized layout", async () => {
      let resolveBuild!: (wg: WorkspaceGraph) => void;
      vi.mocked(createWorkspaceGraph).mockReturnValueOnce(
        new Promise<WorkspaceGraph>((res) => {
          resolveBuild = res;
        }),
      );

      const state = new SessionState();
      const p1 = state.getOrBuildWorkspace(root);
      const p2 = state.getOrBuildWorkspace(root);

      resolveBuild(makeWorkspaceGraph(root, [makeNode("src/a.ts")]));
      const [g1, g2] = await Promise.all([p1, p2]);
      expect(g1).toBe(g2); // both concurrent callers get the one built graph

      expect(vi.mocked(createWorkspaceGraph)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(createWorkspaceGraph).mock.calls[0]?.[1]).toMatchObject({
        layout: state.getLayout(root),
      });

      // After settle the in-flight entry is gone and the resolved graph is cached.
      const p3 = state.getOrBuildWorkspace(root);
      await expect(p3).resolves.toBe(await p1);
      expect(vi.mocked(createWorkspaceGraph)).toHaveBeenCalledTimes(1);
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
