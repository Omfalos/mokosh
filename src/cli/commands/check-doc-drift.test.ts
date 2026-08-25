import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./check-doc-drift";
import { makeContext, makeFixtureGraph } from "./test-context";

function makeGraphWithStaleDoc(): Graph {
  return Graph.deserialize({
    nodes: [
      {
        path: "README.md",
        type: "markdown",
        category: "other",
        tags: [],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
        staleFor: ["src/a.ts"],
      },
    ],
  });
}

describe("check-doc-drift command", { tags: ["check-doc-drift"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a clean confirmation when no markdown node has staleFor entries", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    expect(logSpy).toHaveBeenCalledWith("No doc drift detected.");
  });

  it("writes stale docs to stderr and exits 1 when any are found", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeGraphWithStaleDoc() }));

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Found 1 doc(s)"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("README.md"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("src/a.ts"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
