import { afterEach, describe, expect, it, vi } from "vitest";
import { Graph, WorkspaceGraph } from "../../index";
import { runWorkspacePackages } from "./workspace-packages";

function makeWorkspaceGraph(): WorkspaceGraph {
  const wg = new WorkspaceGraph("/tmp/workspace", "npm");
  wg.addPackage(
    { name: "pkg-a", root: "/tmp/workspace/pkg-a", relativeRoot: "pkg-a", entryPoints: [] },
    new Graph(new Map()),
  );
  return wg;
}

describe("workspace-packages command", { tags: ["workspace-packages"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a summary of every package in the workspace", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    runWorkspacePackages(makeWorkspaceGraph());

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output).toEqual({
      monorepoType: "npm",
      packageCount: 1,
      packages: [{ name: "pkg-a", relativeRoot: "pkg-a", nodeCount: 0, dependsOn: [] }],
    });
  });
});
