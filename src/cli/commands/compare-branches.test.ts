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

  it("delegates to compareBranches and prints the result as JSON", async () => {
    const comparison = { base: { ref: "main", sha: "abc" } } as unknown as BranchComparison;
    compareBranchesMock.mockResolvedValue(comparison);
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
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(comparison, null, 2));
  });
});
