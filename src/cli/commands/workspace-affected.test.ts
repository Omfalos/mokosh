import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph, WorkspaceGraph } from "../../index";
import { runWorkspaceAffected } from "./workspace-affected";

function makeWorkspaceGraph(): WorkspaceGraph {
  const wg = new WorkspaceGraph("/tmp/workspace", "npm");
  const graph = Graph.deserialize({
    nodes: [
      {
        path: "pkg-a/src/a.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [],
        exports: [{ name: "foo" }],
        mtime: 0,
        size: 0,
      },
      {
        path: "pkg-a/src/b.ts",
        type: "typescript",
        category: "logic",
        tags: [],
        imports: [
          {
            fromPath: "pkg-a/src/b.ts",
            toPath: "pkg-a/src/a.ts",
            rawSpecifier: "./a",
            isStyle: false,
            type: "static",
            symbols: ["foo"],
          },
        ],
        exports: [],
        mtime: 0,
        size: 0,
      },
    ],
  });
  wg.addPackage(
    { name: "pkg-a", root: "/tmp/workspace/pkg-a", relativeRoot: "pkg-a", entryPoints: [] },
    graph,
  );
  return wg;
}

describe("workspace-affected command", { tags: ["workspace-affected"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the cross-package blast radius for a changed file", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runWorkspaceAffected(makeWorkspaceGraph(), "pkg-a/src/a.ts");

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({
      file: "pkg-a/src/a.ts",
      affected: [{ file: "pkg-a/src/b.ts", package: "pkg-a" }],
      count: 1,
    });
  });

  it("returns an empty result for a file outside any known package", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runWorkspaceAffected(makeWorkspaceGraph(), "pkg-z/src/unknown.ts");

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.affected).toEqual([]);
    expect(output.count).toBe(0);
  });
});
