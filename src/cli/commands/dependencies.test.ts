import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./dependencies";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("dependencies command", { tags: ["dependencies"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints outgoing dependencies for --file", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await run(makeContext({ graph: makeFixtureGraph(), file: "src/b.ts" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.file).toBe("src/b.ts");
    expect(output.dependencies).toEqual([{ path: "src/a.ts", symbols: ["foo"] }]);
  });

  it("errors when --file is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), file: undefined }));

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
