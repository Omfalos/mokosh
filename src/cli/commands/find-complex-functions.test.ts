import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./find-complex-functions";
import { makeContext } from "./test-context";

describe("find-complex-functions command", { tags: ["find-complex-functions"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints functions at or above the threshold, worst-first", async () => {
    const graph = Graph.deserialize({
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
          functions: [
            { name: "small", line: 1, complexity: 2, cognitiveComplexity: 1 },
            { name: "big", line: 5, complexity: 20, cognitiveComplexity: 25 },
          ],
        },
      ],
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph, complexityThreshold: 10 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.functions).toEqual([
      { file: "src/a.ts", name: "big", line: 5, complexity: 20, cognitiveComplexity: 25 },
    ]);
    expect(output.metric).toBe("cognitiveComplexity");
  });
});
