import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./propose-tags";
import { makeContext, makeFixtureGraph } from "./test-context";

const { getChangedFilesMock } = vi.hoisted(() => ({
  getChangedFilesMock: vi.fn((): string[] => []),
}));
vi.mock("../../git", () => ({
  DefaultGitProvider: class {
    getChangedFiles = getChangedFilesMock;
  },
}));

describe("propose-tags command", { tags: ["propose-tags"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getChangedFilesMock.mockReset().mockReturnValue([]);
  });

  it("prints a progress message and proposes no tags when nothing changed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    expect(logSpy).toHaveBeenCalledWith("Proposing test tags based on git diff...");
    const output = JSON.parse(logSpy.mock.calls[1]?.[0] as string);
    expect(output).toEqual({ proposedTags: [] });
  });

  it("proposes a tag for a changed file that a test directly imports", async () => {
    getChangedFilesMock.mockReturnValue(["src/a.ts"]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    const output = JSON.parse(logSpy.mock.calls[1]?.[0] as string);
    expect(output.proposedTags).toEqual(expect.any(Array));
  });

  it("prints space-separated plain output with --plain, suppressing the progress message", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), plain: true }));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("");
  });

  it("passes --base through to the git provider", async () => {
    await run(makeContext({ graph: makeFixtureGraph(), base: "origin/main" }));

    expect(getChangedFilesMock).toHaveBeenCalledWith(expect.any(String), "origin/main");
  });
});
