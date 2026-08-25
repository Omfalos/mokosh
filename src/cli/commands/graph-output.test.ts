import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./graph-output";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("graph-output command", { tags: ["graph-output"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the full serialized graph plus language coverage by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.nodes.map((node: { path: string }) => node.path).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(output.languageCoverage).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "typescript" })]),
    );
  });

  it("prints a slim graph with --slim", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), slim: true }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    const nodeB = output.nodes.find((node: { path: string }) => node.path === "src/b.ts");
    expect(nodeB.importsFiles).toEqual(["src/a.ts"]);
    // slim nodes drop edge objects/mtime/size present in the full shape
    expect(nodeB.imports).toBeUndefined();
    expect(nodeB.mtime).toBeUndefined();
  });

  it("narrows the graph with --query before serializing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), queryStr: "path:a.ts" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.nodes.map((node: { path: string }) => node.path)).toEqual(["src/a.ts"]);
  });

  it("prints a Mermaid diagram with --mermaid instead of JSON", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), mermaidOutput: true }));

    expect(logSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining("graph"));
    expect(() => JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toThrow();
  });

  it("includes cycles in the output when the graph has any", async () => {
    const cyclicGraph = makeFixtureGraph();
    vi.spyOn(cyclicGraph, "findCycles").mockReturnValue([["src/a.ts", "src/b.ts", "src/a.ts"]]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: cyclicGraph }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.cycles).toEqual([["src/a.ts", "src/b.ts", "src/a.ts"]]);
  });
});
