import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchComparison } from "../../index";
import { run } from "./compare-branches";
import { makeContext, makeFixtureGraph } from "./test-context";

const compareBranchesMock = vi.hoisted(() => vi.fn());

vi.mock("../../index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../index")>();
  return { ...actual, compareBranches: compareBranchesMock };
});

describe("compare-branches command", { tags: ["compare-branches", "cli"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors and exits when --compare-branches has no base ref", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), compareBranches: undefined }));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--compare-branches"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  const fullComparison = (): BranchComparison => ({
    base: { ref: "main", sha: "abc1234567890" },
    head: { ref: "HEAD", sha: "def1234567890" },
    files: { added: ["src/new.ts"], removed: [], changed: [] },
    staleReferences: [],
    duplication: { base: { groups: 3 }, head: { groups: 3 }, newGroups: [], resolvedGroups: [] },
    complexity: {
      base: { avgCognitiveComplexity: 5 },
      head: { avgCognitiveComplexity: 5 },
      newHotspots: [],
      resolvedHotspots: [],
    },
    docDrift: { base: { staleCount: 0 }, head: { staleCount: 0 }, newlyStale: [], resolved: [] },
    coverage: null,
  });

  it("delegates to compareBranches and prints the compact summary as JSON by default", async () => {
    compareBranchesMock.mockResolvedValue(fullComparison());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(
      makeContext({
        graph: makeFixtureGraph(),
        rootDir: "/tmp/mokosh-test",
        compareBranches: "main",
        entryPoints: ["src/b.ts"],
        minDuplicateLines: 8,
      }),
    );

    expect(compareBranchesMock).toHaveBeenCalledWith(
      "/tmp/mokosh-test",
      "main",
      expect.anything(),
      expect.objectContaining({ entryPoints: ["src/b.ts"], minDuplicateLines: 8 }),
    );
    const printed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(printed).toMatchObject({ base: "main@abc12345", verdict: "clean", files: { added: 1 } });
    expect(printed.complexity).toBeUndefined();
  });

  it("prints the full BranchComparison verbatim with --compare-full", async () => {
    const comparison = fullComparison();
    compareBranchesMock.mockResolvedValue(comparison);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(
      makeContext({
        graph: makeFixtureGraph(),
        rootDir: "/tmp/mokosh-test",
        compareBranches: "main",
        compareFull: true,
      }),
    );

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(comparison, null, 2));
  });
});
