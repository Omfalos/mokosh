import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchComparison } from "../index";
import { Graph, WorkspaceGraph } from "../index";
import type { SessionState } from "./cache";
import { handleCompareBranches } from "./handlers";

const { compareBranchesMock, createWorkspaceGraphMock } = vi.hoisted(() => ({
  compareBranchesMock: vi.fn(),
  createWorkspaceGraphMock: vi.fn(),
}));

vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return {
    ...actual,
    compareBranches: compareBranchesMock,
    createWorkspaceGraph: createWorkspaceGraphMock,
  };
});

const ROOT = "/tmp/mokosh-test";

function makeCache(overrides: Partial<SessionState> = {}): SessionState {
  const graph = Graph.deserialize({ nodes: [] });
  return {
    ensureFresh: vi.fn().mockResolvedValue(graph),
    isWorkspaceRoot: vi.fn().mockReturnValue(false),
    getConfig: vi.fn().mockReturnValue({}),
    getLastEntryPoints: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as SessionState;
}

function parse(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

const fullComparison = (): BranchComparison => ({
  base: { ref: "main", sha: "abc1234567890" },
  head: { ref: "HEAD", sha: "def1234567890" },
  files: { added: [], removed: [], changed: [] },
  staleReferences: [],
  duplication: { base: { groups: 0 }, head: { groups: 0 }, newGroups: [], resolvedGroups: [] },
  complexity: {
    base: { avgCognitiveComplexity: 0 },
    head: { avgCognitiveComplexity: 0 },
    newHotspots: [],
    resolvedHotspots: [],
  },
  docDrift: { base: { staleCount: 0 }, head: { staleCount: 0 }, newlyStale: [], resolved: [] },
  coverage: null,
});

describe("handleCompareBranches", { tags: ["handleCompareBranches", "mcp"] }, () => {
  beforeEach(() => {
    compareBranchesMock.mockReset();
    createWorkspaceGraphMock.mockReset();
  });

  it("returns the compact summary by default", async () => {
    compareBranchesMock.mockResolvedValue(fullComparison());
    const cache = makeCache();

    const result = await handleCompareBranches(cache, { root: ROOT, baseRef: "main" });

    expect(compareBranchesMock).toHaveBeenCalledWith(
      ROOT,
      "main",
      expect.anything(),
      expect.objectContaining({ entryPoints: [] }),
    );
    expect(parse(result)).toMatchObject({ base: "main@abc12345", verdict: "clean" });
  });

  it("returns the full BranchComparison verbatim with detail:'full'", async () => {
    const comparison = fullComparison();
    compareBranchesMock.mockResolvedValue(comparison);
    const cache = makeCache();

    const result = await handleCompareBranches(cache, {
      root: ROOT,
      baseRef: "main",
      detail: "full",
    });

    expect(parse(result)).toEqual(comparison);
  });

  it("falls back to the last analyze() entry points, relativized to root", async () => {
    compareBranchesMock.mockResolvedValue(fullComparison());
    const cache = makeCache({
      getLastEntryPoints: vi.fn().mockReturnValue([`${ROOT}/src/b.ts`]),
    });

    await handleCompareBranches(cache, { root: ROOT, baseRef: "main" });

    expect(compareBranchesMock).toHaveBeenCalledWith(
      ROOT,
      "main",
      expect.anything(),
      expect.objectContaining({ entryPoints: ["src/b.ts"] }),
    );
  });

  it("prefers explicit entryPoints over the stored last-analyze ones", async () => {
    compareBranchesMock.mockResolvedValue(fullComparison());
    const cache = makeCache({
      getLastEntryPoints: vi.fn().mockReturnValue([`${ROOT}/src/b.ts`]),
    });

    await handleCompareBranches(cache, {
      root: ROOT,
      baseRef: "main",
      entryPoints: ["src/other.ts"],
    });

    expect(compareBranchesMock).toHaveBeenCalledWith(
      ROOT,
      "main",
      expect.anything(),
      expect.objectContaining({ entryPoints: ["src/other.ts"] }),
    );
  });

  describe("monorepo root", () => {
    function workspaceCache(): SessionState {
      const wg = new WorkspaceGraph(ROOT, "pnpm");
      wg.addPackage(
        { name: "@org/a", root: `${ROOT}/packages/a`, relativeRoot: "packages/a", entryPoints: [] },
        Graph.deserialize({ nodes: [] }),
      );
      return makeCache({
        isWorkspaceRoot: vi.fn().mockReturnValue(true),
        ensureFreshWorkspace: vi.fn().mockResolvedValue(wg),
      } as Partial<SessionState>);
    }

    it("compares the flattened workspace and passes a workspaceBuilder for the base ref", async () => {
      compareBranchesMock.mockResolvedValue(fullComparison());

      await handleCompareBranches(workspaceCache(), { root: ROOT, baseRef: "HEAD~5" });

      const opts = compareBranchesMock.mock.calls[0]?.[3] as Record<string, unknown>;
      expect(opts.entryPoints).toEqual([]);
      expect(typeof opts.workspaceBuilder).toBe("function");
    });

    it("the workspaceBuilder builds + flattens a WorkspaceGraph at the worktree dir", async () => {
      compareBranchesMock.mockResolvedValue(fullComparison());
      const flatGraph = Graph.deserialize({ nodes: [] });
      createWorkspaceGraphMock.mockResolvedValue({ flatten: () => ({ graph: flatGraph }) });

      await handleCompareBranches(workspaceCache(), { root: ROOT, baseRef: "HEAD~5" });

      const opts = compareBranchesMock.mock.calls[0]?.[3] as {
        workspaceBuilder: (dir: string) => Promise<Graph>;
      };
      const built = await opts.workspaceBuilder("/tmp/worktree-xyz");
      expect(createWorkspaceGraphMock).toHaveBeenCalledWith(
        "/tmp/worktree-xyz",
        expect.objectContaining({ silent: true }),
      );
      expect(built).toBe(flatGraph);
    });

    it("rejects explicit entryPoints on a monorepo root", async () => {
      await expect(
        handleCompareBranches(workspaceCache(), {
          root: ROOT,
          baseRef: "main",
          entryPoints: ["packages/a/src/index.ts"],
        }),
      ).rejects.toThrow(/whole workspace/);
      expect(compareBranchesMock).not.toHaveBeenCalled();
    });
  });
});
