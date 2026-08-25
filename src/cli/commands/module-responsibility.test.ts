import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./module-responsibility";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("module-responsibility command", { tags: ["module-responsibility"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints responsibility info for every module when --paths is omitted", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.count).toBe(2);
    expect(output.modules.map((module: { path: string }) => module.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("filters to the given --paths", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), filterPaths: ["src/a.ts"] }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.count).toBe(1);
    expect(output.modules[0].path).toBe("src/a.ts");
  });

  it("drops --paths entries that don't resolve to a module", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), filterPaths: ["src/does-not-exist.ts"] }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.count).toBe(0);
  });
});
