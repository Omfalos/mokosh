import { describe, expect, test, vi } from "vitest";
import { Graph } from "../index";
import type { SerializedGraph } from "../types";
import type { SessionState } from "./cache";
import {
  handleAnalyze,
  handleDetectFeatures,
  handleFindUnused,
  handleGetAffected,
  handleGetDependencies,
  handleGetDependents,
  handleProposeAffectedTests,
  handleProposeTags,
  handleQuery,
} from "./handlers";

vi.mock("../index", async (importActual) => {
  const actual = await importActual<typeof import("../index")>();
  return {
    ...actual,
    applyConfig: vi.fn(),
    loadMokoshConfig: vi.fn().mockReturnValue({}),
    getAllProjectFiles: vi
      .fn()
      .mockReturnValue(["src/a.ts", "src/b.ts", "src/a.test.ts", "src/orphan.ts"]),
  };
});

const ROOT = "/tmp/mokosh-test";

// Fixture: b.ts → a.ts ← a.test.ts
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
        },
      ],
      exports: [],
      mtime: 0,
      size: 0,
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

function makeCache(): SessionState {
  const graph = Graph.deserialize(FIXTURE);
  return {
    isConfigured: vi.fn().mockReturnValue(false),
    markConfigured: vi.fn(),
    getOrBuild: vi.fn().mockResolvedValue(graph),
    require: vi.fn().mockReturnValue(graph),
  } as unknown as SessionState;
}

function parse(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe("handleAnalyze", () => {
  test("returns node count and categories", async () => {
    const cache = makeCache();
    const data = parse(await handleAnalyze(cache, { root: ROOT, entryPoints: ["src/a.ts"] })) as {
      nodeCount: number;
      categories: Record<string, number>;
      cycles: unknown[];
    };

    expect(data.nodeCount).toBe(3);
    expect(data.categories).toEqual({ logic: 2, test: 1 });
    expect(data.cycles).toEqual([]);
  });

  test("applies config when root is not yet configured", async () => {
    const { loadMokoshConfig, applyConfig } = await import("../index.js");
    const cache = makeCache();
    await handleAnalyze(cache, { root: ROOT, entryPoints: ["src/a.ts"] });

    expect(loadMokoshConfig).toHaveBeenCalledWith(ROOT, { allowJs: false });
    expect(applyConfig).toHaveBeenCalled();
    expect(cache.markConfigured).toHaveBeenCalledWith(ROOT);
  });

  test("skips config when root is already configured", async () => {
    const { applyConfig } = await import("../index.js");
    vi.mocked(applyConfig).mockClear();
    const cache = makeCache();
    vi.mocked(cache.isConfigured).mockReturnValue(true);

    await handleAnalyze(cache, { root: ROOT, entryPoints: ["src/a.ts"] });

    expect(applyConfig).not.toHaveBeenCalled();
  });
});

describe("handleGetDependencies", () => {
  test("returns immediate imports at depth 1", async () => {
    const data = parse(handleGetDependencies(makeCache(), { root: ROOT, file: "src/b.ts" })) as {
      dependencies: string[];
    };

    expect(data.dependencies).toContain("src/a.ts");
    expect(data.dependencies).not.toContain("src/b.ts");
  });

  test("does not traverse past leaves even at higher depth", async () => {
    const data = parse(
      handleGetDependencies(makeCache(), { root: ROOT, file: "src/b.ts", depth: 10 }),
    ) as { dependencies: string[] };

    expect(data.dependencies).toEqual(["src/a.ts"]);
  });
});

describe("handleGetDependents", () => {
  test("returns direct importers of a file", async () => {
    const data = parse(handleGetDependents(makeCache(), { root: ROOT, file: "src/a.ts" })) as {
      dependents: string[];
    };

    expect(data.dependents).toContain("src/b.ts");
    expect(data.dependents).toContain("src/a.test.ts");
  });
});

describe("handleGetAffected", () => {
  test("returns all upstream files", async () => {
    const data = parse(handleGetAffected(makeCache(), { root: ROOT, file: "src/a.ts" })) as {
      affected: string[];
    };

    expect(data.affected).toContain("src/b.ts");
    expect(data.affected).toContain("src/a.test.ts");
  });

  test("testsOnly filters to test-category files", async () => {
    const data = parse(
      handleGetAffected(makeCache(), { root: ROOT, file: "src/a.ts", testsOnly: true }),
    ) as { affected: string[] };

    expect(data.affected).toContain("src/a.test.ts");
    expect(data.affected).not.toContain("src/b.ts");
  });
});

describe("handleFindUnused", () => {
  test("returns files not reachable from the graph", async () => {
    const data = parse(
      await handleFindUnused(makeCache(), { root: ROOT, entryPoints: ["src/a.ts"] }),
    ) as { unusedFiles: string[]; count: number };

    expect(data.unusedFiles).toContain("src/orphan.ts");
    expect(data.unusedFiles).not.toContain("src/a.ts");
    expect(data.count).toBe(data.unusedFiles.length);
  });
});

describe("handleProposeTags", () => {
  test("returns tags from test files affected by changed files", async () => {
    const data = parse(
      handleProposeTags(makeCache(), { root: ROOT, changedFiles: ["src/a.ts"] }),
    ) as { proposedTags: string[] };

    expect(data.proposedTags).toContain("a");
  });
});

describe("handleProposeAffectedTests", () => {
  test("returns test file paths affected by changed files", async () => {
    const data = parse(
      handleProposeAffectedTests(makeCache(), { root: ROOT, changedFiles: ["src/a.ts"] }),
    ) as { affectedTests: string[]; count: number };

    expect(data.affectedTests).toContain("src/a.test.ts");
    expect(data.count).toBe(data.affectedTests.length);
  });
});

describe("handleDetectFeatures", () => {
  test("returns features sorted by out-degree", async () => {
    const data = parse(await handleDetectFeatures(makeCache(), { root: ROOT })) as {
      features: Array<{ path: string; outDegree: number }>;
      count: number;
    };

    expect(Array.isArray(data.features)).toBe(true);
    expect(data.count).toBe(data.features.length);
    for (let i = 1; i < data.features.length; i++) {
      expect(data.features[i - 1]!.outDegree).toBeGreaterThanOrEqual(data.features[i]!.outDegree);
    }
  });
});

describe("handleQuery", () => {
  test("filters nodes by category", async () => {
    const data = parse(
      await handleQuery(makeCache(), { root: ROOT, filter: "category:logic" }),
    ) as { nodes: Array<{ category: string }> };

    expect(data.nodes.length).toBeGreaterThan(0);
    for (const node of data.nodes) {
      expect(node.category).toBe("logic");
    }
  });

  test("filters nodes by tag", async () => {
    const data = parse(await handleQuery(makeCache(), { root: ROOT, filter: "tag:auth" })) as {
      nodes: Array<{ path: string }>;
    };

    expect(data.nodes).toHaveLength(1);
    expect(data.nodes[0]?.path).toBe("src/a.ts");
  });

  test("returns a Mermaid diagram when mermaid=true", async () => {
    const result = await handleQuery(makeCache(), {
      root: ROOT,
      filter: "category:logic",
      mermaid: true,
    });

    expect(result.content[0]?.text).toContain("graph TD");
  });
});
