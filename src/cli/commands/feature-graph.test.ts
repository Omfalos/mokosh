import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./feature-graph";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("feature-graph command", { tags: ["feature-graph"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("groups nothing into a feature domain below the default hub threshold", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.features).toEqual({});
    expect(output.unassigned).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts"]));
  });

  it("assigns files to a hub domain when --min-out-degree is lowered", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), minOutDegree: 1 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.features.b).toEqual({ hub: "src/b.ts", outDegree: 1, files: ["src/a.ts"] });
  });
});
