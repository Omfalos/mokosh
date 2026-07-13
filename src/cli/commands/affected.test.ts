import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./affected";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("affected command", { tags: ["affected"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the full transitive incoming set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await run(makeContext({ graph: makeFixtureGraph(), file: "src/a.ts" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.affected).toEqual(["src/b.ts"]);
    expect(output.count).toBe(1);
  });

  it("supports --cached mode via the change impact cache", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await run(makeContext({ graph: makeFixtureGraph(), file: "src/a.ts", cached: true }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.affected).toEqual(["src/b.ts"]);
  });

  it("errors when --file is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), file: undefined }));

    expect(errorSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
