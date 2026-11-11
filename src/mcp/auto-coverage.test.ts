import { beforeEach, describe, expect, test, vi } from "vitest";
import { Graph } from "../index";
import type { FileNode } from "../types/node";

vi.mock("../graph/coverage/get-or-run", () => ({ getOrRunCoverage: vi.fn() }));
vi.mock("../graph/coverage/static-estimate", () => ({ applyStaticCoverage: vi.fn() }));

import { getOrRunCoverage } from "../graph/coverage/get-or-run";
import { applyStaticCoverage } from "../graph/coverage/static-estimate";
import { applyOnDemandCoverage } from "./auto-coverage";

const layout = { root: "/r", type: "none", types: [], packages: [], packageMap: new Map() };
const node: FileNode = {
  path: "a.ts",
  type: "typescript",
  category: "logic",
  imports: [],
  exports: [],
  tags: [],
  mtime: 1,
  size: 1,
};
const makeGraph = () => new Graph(new Map([["a.ts", { ...node }]]));

beforeEach(() => vi.clearAllMocks());

describe("applyOnDemandCoverage", () => {
  test("is a no-op when no coverage config is present", async () => {
    await applyOnDemandCoverage("/r", makeGraph(), layout, undefined);
    expect(applyStaticCoverage).not.toHaveBeenCalled();
    expect(getOrRunCoverage).not.toHaveBeenCalled();
  });

  test("static mode applies the static estimate and never runs tests", async () => {
    const graph = makeGraph();
    await applyOnDemandCoverage("/r", graph, layout, { mode: "static" });
    expect(applyStaticCoverage).toHaveBeenCalledWith(graph);
    expect(getOrRunCoverage).not.toHaveBeenCalled();
  });

  test("exec mode forwards timeout/packages and writes the returned percentages onto nodes", async () => {
    vi.mocked(getOrRunCoverage).mockResolvedValueOnce(new Map([["a.ts", 42]]));
    const graph = makeGraph();
    await applyOnDemandCoverage("/r", graph, layout, {
      mode: "exec",
      timeoutMs: 5,
      packages: ["p"],
    });
    expect(getOrRunCoverage).toHaveBeenCalledWith("/r", expect.anything(), layout, {
      timeoutMs: 5,
      packages: ["p"],
    });
    expect(graph.nodes.get("a.ts")?.coveragePct).toBe(42);
  });

  test("exec mode with an empty result leaves coverage untouched", async () => {
    vi.mocked(getOrRunCoverage).mockResolvedValueOnce(new Map());
    const graph = makeGraph();
    await applyOnDemandCoverage("/r", graph, layout, { mode: "exec" });
    expect(graph.nodes.get("a.ts")?.coveragePct).toBeUndefined();
  });
});
