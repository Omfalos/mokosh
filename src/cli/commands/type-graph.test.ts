import { afterEach, describe, expect, it, vi } from "vitest";
import { makeContext, makeFixtureGraph } from "./test-context";
import { run } from "./type-graph";

describe("type-graph command", { tags: ["type-graph"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints all types with a count when --type is not given", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), typeFilter: undefined }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({ count: 0, types: [] });
  });

  it("returns an empty usage result for a --type not present in the graph", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), typeFilter: "NotAType" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({ type: null, usedByFiles: [], uses: [] });
  });
});
