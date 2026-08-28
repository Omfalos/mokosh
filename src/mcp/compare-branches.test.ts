import { describe, expect, it, vi } from "vitest";
import type { BranchComparison } from "../index";
import { Graph } from "../index";
import type { SessionState } from "./cache";
import { handleCompareBranches } from "./handlers";

const compareBranchesMock = vi.hoisted(() => vi.fn());

vi.mock("../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../index")>();
  return { ...actual, compareBranches: compareBranchesMock };
});

const ROOT = "/tmp/mokosh-test";

function makeCache(overrides: Partial<SessionState> = {}): SessionState {
  const graph = Graph.deserialize({ nodes: [] });
  return {
    ensureFresh: vi.fn().mockResolvedValue(graph),
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
});
