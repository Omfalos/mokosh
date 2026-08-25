import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./api-surface";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("api-surface command", { tags: ["api-surface"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the API surface from explicit positional entry points", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), entryPoints: ["src/a.ts"] }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.publicExports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "foo" })]),
    );
  });

  it("errors when no entry points are given and none can be auto-detected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit(1)");
    });

    await expect(
      run(
        makeContext({
          graph: makeFixtureGraph(),
          entryPoints: [],
          rootDir: "/tmp/mokosh-no-pkg-json",
        }),
      ),
    ).rejects.toThrow("process.exit(1)");

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No entry points found"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
