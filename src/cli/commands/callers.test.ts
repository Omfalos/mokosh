import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./callers";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("callers command", { tags: ["callers"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors when --file is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), file: undefined }));

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--callers requires --file"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints JSON with an empty caller list for a file with no call edges", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), file: "src/a.ts" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({ file: "src/a.ts", callers: [], count: 0 });
  });

  it("prints plain newline-separated file paths with --plain", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), file: "src/a.ts", plain: true }));

    expect(logSpy).toHaveBeenCalledWith("");
  });
});
