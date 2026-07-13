import { describe, expect, test } from "vitest";
import type { SerializedGraph } from "../types/graph";
import { Graph } from "./model";
import {
  findComplexFunctions,
  getAffected,
  getCallers,
  getDependencies,
  getDependents,
  hasCoverageData,
  slimSerialize,
  summarizeWorkspacePackages,
} from "./queries";
import { WorkspaceGraph } from "./workspace-model";

// Fixture: b.ts -> a.ts <- a.test.ts, with a call edge b.ts -> a.ts
const FIXTURE: SerializedGraph = {
  nodes: [
    {
      path: "src/a.ts",
      type: "typescript",
      category: "logic",
      tags: [{ name: "auth", kind: "comment-marker" as const }],
      imports: [],
      exports: [{ name: "foo" }],
      mtime: 0,
      size: 0,
      functions: [
        { name: "foo", line: 1, complexity: 12, cognitiveComplexity: 15 },
        { name: "bar", line: 10, complexity: 2, cognitiveComplexity: 1 },
      ],
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
          symbols: ["foo"],
        },
      ],
      exports: [],
      mtime: 0,
      size: 0,
      callEdges: [{ from: "run", to: "foo", toFile: "src/a.ts" }],
    },
    {
      path: "src/a.test.ts",
      type: "typescript",
      category: "test",
      tags: [{ name: "a", kind: "comment-marker" as const }],
      imports: [
        {
          fromPath: "src/a.test.ts",
          toPath: "src/a.ts",
          rawSpecifier: "./a",
          isStyle: false,
          type: "static",
        },
      ],
      exports: [],
      mtime: 0,
      size: 0,
    },
  ],
};

function makeGraph(): Graph {
  return Graph.deserialize(FIXTURE);
}

describe("getDependencies", () => {
  test("returns immediate imports with symbols", () => {
    const deps = getDependencies(makeGraph(), "src/b.ts");
    expect(deps).toEqual([{ path: "src/a.ts", symbols: ["foo"] }]);
  });

  test("does not traverse past leaves at higher depth", () => {
    const deps = getDependencies(makeGraph(), "src/b.ts", 10);
    expect(deps.map((d) => d.path)).toEqual(["src/a.ts"]);
  });
});

describe("getDependents", () => {
  test("returns direct importers", () => {
    const dependents = getDependents(makeGraph(), "src/a.ts").map((d) => d.path);
    expect(dependents).toContain("src/b.ts");
    expect(dependents).toContain("src/a.test.ts");
  });
});

describe("getAffected", () => {
  test("returns full transitive incoming set", () => {
    const affected = getAffected(makeGraph(), "src/a.ts");
    expect(affected.sort()).toEqual(["src/a.test.ts", "src/b.ts"]);
  });

  test("testsOnly restricts to test category", () => {
    const affected = getAffected(makeGraph(), "src/a.ts", { testsOnly: true });
    expect(affected).toEqual(["src/a.test.ts"]);
  });

  test("changedSymbols prunes files that do not import the changed symbol", () => {
    const affected = getAffected(makeGraph(), "src/a.ts", { changedSymbols: ["foo"] });
    expect(affected).toContain("src/b.ts");
  });
});

describe("getCallers", () => {
  test("returns files with call edges into the target", () => {
    const callers = getCallers(makeGraph(), "src/a.ts");
    expect(callers).toEqual([{ file: "src/b.ts" }]);
  });

  test("withEdgeDetail includes from/to function names", () => {
    const callers = getCallers(makeGraph(), "src/a.ts", { withEdgeDetail: true });
    expect(callers[0]?.edges).toEqual([{ from: "run", to: "foo" }]);
  });
});

describe("findComplexFunctions", () => {
  test("filters by threshold and sorts worst-first on the given metric", () => {
    const functions = findComplexFunctions(makeGraph(), { metric: "complexity", threshold: 5 });
    expect(functions).toEqual([
      { file: "src/a.ts", name: "foo", line: 1, complexity: 12, cognitiveComplexity: 15 },
    ]);
  });

  test("respects limit", () => {
    const functions = findComplexFunctions(makeGraph(), { threshold: 0, limit: 1 });
    expect(functions).toHaveLength(1);
  });
});

describe("hasCoverageData", () => {
  test("false when no node has coveragePct", () => {
    expect(hasCoverageData(makeGraph())).toBe(false);
  });

  test("true when at least one node has coveragePct", () => {
    const graph = makeGraph();
    graph.nodes.get("src/a.ts")!.coveragePct = 50;
    expect(hasCoverageData(graph)).toBe(true);
  });
});

describe("slimSerialize", () => {
  test("strips edge metadata into a flat importsFiles list", () => {
    const slim = slimSerialize(makeGraph().serialize());
    const bNode = slim.nodes.find((n) => n.path === "src/b.ts");
    expect(bNode?.importsFiles).toEqual(["src/a.ts"]);
    expect(bNode).not.toHaveProperty("imports");
  });

  test("only includes comment-marker and import tags", () => {
    const slim = slimSerialize(makeGraph().serialize());
    const aNode = slim.nodes.find((n) => n.path === "src/a.ts");
    expect(aNode?.tags).toEqual(["auth"]);
  });
});

describe("summarizeWorkspacePackages", () => {
  test("summarizes node counts and cross-package dependencies", () => {
    const wg = new WorkspaceGraph("/repo", "pnpm");
    wg.addPackage(
      { name: "pkg-a", relativeRoot: "packages/a", root: "/repo/packages/a", entryPoints: [] },
      makeGraph(),
    );
    const summary = summarizeWorkspacePackages(wg);
    expect(summary).toEqual({
      monorepoType: "pnpm",
      packageCount: 1,
      packages: [{ name: "pkg-a", relativeRoot: "packages/a", nodeCount: 3, dependsOn: [] }],
    });
  });
});
