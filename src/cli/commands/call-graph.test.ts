import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./call-graph";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("call-graph command", { tags: ["call-graph"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors when --function is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: undefined }));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--call-graph requires --function"),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("finds the defining file for an exported symbol with no call edges", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: "foo" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({
      functionName: "foo",
      definedIn: "src/a.ts",
      callers: [],
      callees: [],
    });
  });

  it("reports null definedIn for an unknown function", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), functionName: "doesNotExist" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.definedIn).toBeNull();
  });
});
