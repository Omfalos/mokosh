import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./find-symbol";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("find-symbol command", { tags: ["find-symbol"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors when --function is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: undefined }));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--find-symbol requires --function"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("finds the file exporting the named symbol", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: "foo" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.name).toBe("foo");
    expect(output.count).toBe(1);
    expect(output.matches[0].path).toBe("src/a.ts");
  });

  it("prints plain newline-separated paths with --plain", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: "foo", plain: true }));

    expect(logSpy).toHaveBeenCalledWith("src/a.ts");
  });

  it("returns zero matches for an unknown symbol", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: "doesNotExist" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.count).toBe(0);
    expect(output.matches).toEqual([]);
  });
});
