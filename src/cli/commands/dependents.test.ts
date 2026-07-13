import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./dependents";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("dependents command", { tags: ["dependents"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints direct importers of --file", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await run(makeContext({ graph: makeFixtureGraph(), file: "src/a.ts" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.file).toBe("src/a.ts");
    expect(output.dependents).toEqual([{ path: "src/b.ts", symbols: ["foo"] }]);
  });
});
