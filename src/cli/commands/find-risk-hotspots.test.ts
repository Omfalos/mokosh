import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./find-risk-hotspots";
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
        functions: [{ name: "risky", line: 1, complexity: 20, cognitiveComplexity: 25 }],
      },
    ],
  });
}

function graphWithHotspot(): Graph {
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
        coveragePct: 30,
        commitCount90d: 12,
        functions: [
          { name: "risky", line: 1, complexity: 20, cognitiveComplexity: 25 },
          { name: "fine", line: 10, complexity: 1, cognitiveComplexity: 1 },
        ],
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
        functions: [{ name: "wellTested", line: 1, complexity: 30, cognitiveComplexity: 30 }],
      },
    ],
  });
}

describe("find-risk-hotspots command", { tags: ["find-risk-hotspots"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("errors instead of reporting false positives when no coverage data was loaded", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithoutCoverage() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.error).toMatch(/No coverage data available/);
  });

  it("lists only complex functions in poorly-covered files", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithHotspot(), complexityThreshold: 10 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.hotspots).toEqual([
      {
        file: "src/a.ts",
        name: "risky",
        line: 1,
        complexity: 20,
        cognitiveComplexity: 25,
        coveragePct: 30,
        commitCount90d: 12,
      },
    ]);
    expect(output.churnDataAvailable).toBe(true);
  });

  it("applies --max-coverage-pct and --min-churn overrides", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(
      makeContext({
        graph: graphWithHotspot(),
        complexityThreshold: 10,
        minChurn: 50,
      }),
    );

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.hotspots).toEqual([]);
    expect(output.churnDataAvailable).toBe(true);
  });
});
