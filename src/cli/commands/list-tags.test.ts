import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./list-tags";
import { makeContext } from "./test-context";

function graphWithTags(): Graph {
  return Graph.deserialize({
    nodes: [
      {
        path: "src/a.ts",
        type: "typescript",
        category: "logic",
        tags: [{ name: "auth", kind: "comment-marker" }],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
      },
      {
        path: "src/b.ts",
        type: "typescript",
        category: "logic",
        tags: [
          { name: "auth", kind: "comment-marker" },
          { name: "billing", kind: "comment-marker" },
        ],
        imports: [],
        exports: [],
        mtime: 0,
        size: 0,
      },
    ],
  });
}

function graphWithoutTags(): Graph {
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

describe("list-tags command", { tags: ["list-tags"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a bounded summary; count-1 tags hidden by default", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithTags() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.tags).toEqual([{ name: "auth", count: 2, kinds: ["comment-marker"] }]);
    expect(output.count).toBe(1);
    expect(output.totalDistinct).toBe(2);
    expect(output.byKind).toEqual({ "comment-marker": 2 });
  });

  it("--tag-min-count 1 surfaces the count-1 tag", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithTags(), tagMinCount: 1 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.tags).toEqual([
      { name: "auth", count: 2, kinds: ["comment-marker"] },
      { name: "billing", count: 1, kinds: ["comment-marker"] },
    ]);
  });

  it("--tag-prefix filters by name substring", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithTags(), tagMinCount: 1, tagPrefix: "aut" }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.tags).toEqual([{ name: "auth", count: 2, kinds: ["comment-marker"] }]);
  });

  it("returns an empty list for a graph with no tags", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithoutTags() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.tags).toEqual([]);
    expect(output.count).toBe(0);
    expect(output.totalDistinct).toBe(0);
  });

  it("prints bare tag names when plain=true", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: graphWithTags(), plain: true, tagMinCount: 1 }));

    expect(logSpy.mock.calls[0]?.[0]).toBe("auth\nbilling");
  });
});
