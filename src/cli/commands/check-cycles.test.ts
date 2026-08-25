import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./check-cycles";
import { makeContext, makeFixtureGraph } from "./test-context";

function makeCyclicGraph(): Graph {
  return Graph.deserialize({
    nodes: [
      {
        path: "src/a.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [
          {
            fromPath: "src/a.ts",
            toPath: "src/b.ts",
            rawSpecifier: "./b",
            isStyle: false,
            type: "static",
            symbols: [],
          },
        ],
        exports: [],
        mtime: 0,
        size: 0,
      },
      {
        path: "src/b.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [
          {
            fromPath: "src/b.ts",
            toPath: "src/a.ts",
            rawSpecifier: "./a",
            isStyle: false,
            type: "static",
            symbols: [],
          },
        ],
        exports: [],
        mtime: 0,
        size: 0,
      },
    ],
  });
}

describe("check-cycles command", { tags: ["check-cycles"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a clean confirmation when the graph has no cycles", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    expect(logSpy).toHaveBeenCalledWith("No cycles detected.");
  });

  it("writes each cycle to stderr and exits 1 when cycles are found", async () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run(makeContext({ graph: makeCyclicGraph() }));

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Found 1 cycle(s)"));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("src/a.ts"));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
