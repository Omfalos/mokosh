import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./find-uncovered";
import { makeContext } from "./test-context";

function graphWithoutCoverage(): Graph {
  return Graph.deserialize({
    nodes: [
      {
        path: "src/a.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
      },
    ],
  });
}

function graphWithCoverage(): Graph {
  return Graph.deserialize({
    nodes: [
      {
        path: "src/a.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
        coveragePct: 40,
      },
      {
        path: "src/b.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
        coveragePct: 95,
      },
    ],
  });
}

describe("find-uncovered command", { tags: ["find-uncovered"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors instead of reporting false positives when no coverage data was loaded", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithoutCoverage() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.error).toMatch(/No coverage data available/);
  });

  it("lists only files below the threshold when coverage data is present", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithCoverage(), featureThreshold: 80 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.uncovered).toEqual([{ file: "src/a.ts", coveragePct: 40 }]);
  });
});
