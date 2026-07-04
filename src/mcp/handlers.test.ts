import { describe, expect, test, vi } from "vitest";
import { WorkspaceGraph } from "../graph/workspace-model";
import { Graph } from "../index";
import type { SerializedGraph } from "../types/graph";
import type { SessionState } from "./cache";
import {
  handleAnalyze,
  handleDetectFeatures,
  handleFindUnused,
  handleGetAffected,
  handleGetDependencies,
  handleGetDependents,
  handleGetWorkspaceAffected,
  handleGetWorkspacePackages,
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
    detectMonorepo: vi
      .fn()
      .mockReturnValue({ type: "none", types: [], packages: [], packageMap: new Map(), root: "" }),
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
    storeConfig: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    getOrBuild: vi.fn().mockResolvedValue(graph),
    require: vi.fn().mockReturnValue(graph),
    ensureFresh: vi.fn().mockResolvedValue(graph),
    storeLastAnalyze: vi.fn(),
    startWatching: vi.fn(),
    getOrBuildChangeImpact: vi.fn().mockReturnValue({ impactMap: new Map() }),
  } as unknown as SessionState;
}

function parse(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("handleAnalyze", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
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
    expect(cache.storeConfig).toHaveBeenCalledWith(ROOT, {});
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

describe("handleGetDependencies", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns immediate imports at depth 1", async () => {
    const data = parse(
      await handleGetDependencies(makeCache(), { root: ROOT, file: "src/b.ts" }),
    ) as {
      dependencies: Array<{ path: string; symbols?: string[] }>;
    };

    const paths = data.dependencies.map((d) => d.path);
    expect(paths).toContain("src/a.ts");
    expect(paths).not.toContain("src/b.ts");
  });

  test("does not traverse past leaves even at higher depth", async () => {
    const data = parse(
      await handleGetDependencies(makeCache(), { root: ROOT, file: "src/b.ts", depth: 10 }),
    ) as { dependencies: Array<{ path: string; symbols?: string[] }> };

    expect(data.dependencies.map((d) => d.path)).toEqual(["src/a.ts"]);
  });
});

describe("handleGetDependents", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns direct importers of a file", async () => {
    const data = parse(
      await handleGetDependents(makeCache(), { root: ROOT, file: "src/a.ts" }),
    ) as {
      dependents: Array<{ path: string; symbols?: string[] }>;
    };

    const paths = data.dependents.map((d) => d.path);
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("src/a.test.ts");
  });
});

describe("handleGetAffected", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns all upstream files", async () => {
    const data = parse(await handleGetAffected(makeCache(), { root: ROOT, file: "src/a.ts" })) as {
      affected: string[];
    };

    expect(data.affected).toContain("src/b.ts");
    expect(data.affected).toContain("src/a.test.ts");
  });

  test("testsOnly filters to test-category files", async () => {
    const data = parse(
      await handleGetAffected(makeCache(), { root: ROOT, file: "src/a.ts", testsOnly: true }),
    ) as { affected: string[] };

    expect(data.affected).toContain("src/a.test.ts");
    expect(data.affected).not.toContain("src/b.ts");
  });
});

describe("handleFindUnused", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns files not reachable from the graph", async () => {
    const data = parse(
      await handleFindUnused(makeCache(), { root: ROOT, entryPoints: ["src/a.ts"] }),
    ) as { unusedFiles: string[]; count: number };

    expect(data.unusedFiles).toContain("src/orphan.ts");
    expect(data.unusedFiles).not.toContain("src/a.ts");
    expect(data.count).toBe(data.unusedFiles.length);
  });
});

describe("handleProposeTags", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns tags from test files affected by changed files", async () => {
    const data = parse(
      await handleProposeTags(makeCache(), { root: ROOT, changedFiles: ["src/a.ts"] }),
    ) as { proposedTags: string[] };

    expect(data.proposedTags).toContain("a");
  });
});

describe("handleProposeTags with format='paths'", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns test file paths affected by changed files", async () => {
    const data = parse(
      await handleProposeTags(makeCache(), {
        root: ROOT,
        changedFiles: ["src/a.ts"],
        format: "paths",
      }),
    ) as { affectedTests: string[]; count: number };

    expect(data.affectedTests).toContain("src/a.test.ts");
    expect(data.count).toBe(data.affectedTests.length);
  });
});

describe("handleDetectFeatures", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns features sorted by out-degree", async () => {
    const data = parse(await handleDetectFeatures(makeCache(), { root: ROOT })) as {
      features: Array<{ path: string; outDegree: number }>;
      count: number;
    };

    expect(Array.isArray(data.features)).toBe(true);
    expect(data.count).toBe(data.features.length);
    for (let i = 1; i < data.features.length; i++) {
      expect(data.features[i - 1]?.outDegree ?? 0).toBeGreaterThanOrEqual(
        data.features[i]?.outDegree ?? 0,
      );
    }
  });
});

describe("handleQuery", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
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

// ─── workspace helpers ────────────────────────────────────────────────────────

function makeWorkspaceFixture(): WorkspaceGraph {
  const sharedUtils = {
    path: "packages/shared/src/utils.ts",
    type: "typescript" as const,
    category: "logic" as const,
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
  const sharedGraph = new Graph(new Map([["packages/shared/src/utils.ts", sharedUtils]]));

  const appPage = {
    path: "packages/app/src/page.ts",
    type: "typescript" as const,
    category: "logic" as const,
    imports: [
      {
        fromPath: "packages/app/src/page.ts",
        toPath: "packages/shared/src/utils.ts",
        rawSpecifier: "@org/shared",
        isStyle: false,
        type: "static" as const,
        isWorkspace: true,
        workspacePackage: "@org/shared",
      },
    ],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  };
  const appGraph = new Graph(new Map([["packages/app/src/page.ts", appPage]]));

  const wg = new WorkspaceGraph(ROOT, "pnpm");
  wg.addPackage(
    {
      name: "@org/shared",
      root: `${ROOT}/packages/shared`,
      relativeRoot: "packages/shared",
      entryPoints: [],
    },
    sharedGraph,
  );
  wg.addPackage(
    {
      name: "@org/app",
      root: `${ROOT}/packages/app`,
      relativeRoot: "packages/app",
      entryPoints: [],
    },
    appGraph,
  );
  return wg;
}

function makeWorkspaceCache(wg: WorkspaceGraph): SessionState {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    storeConfig: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    getOrBuild: vi.fn(),
    require: vi.fn(),
    getOrBuildWorkspace: vi.fn().mockResolvedValue(wg),
    requireWorkspace: vi.fn().mockReturnValue(wg),
    hasWorkspace: vi.fn().mockReturnValue(true),
    ensureFreshWorkspace: vi.fn().mockResolvedValue(wg),
    storeLastAnalyze: vi.fn(),
    startWatching: vi.fn(),
  } as unknown as SessionState;
}

describe("handleAnalyze (monorepo auto-detection)", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("routes to workspace build when entryPoints is empty and monorepo is detected", async () => {
    const { detectMonorepo } = await import("../index.js");
    vi.mocked(detectMonorepo).mockReturnValue({
      type: "pnpm",
      types: ["pnpm"],
      root: ROOT,
      packages: [
        {
          name: "@org/shared",
          root: `${ROOT}/packages/shared`,
          relativeRoot: "packages/shared",
          entryPoints: [],
        },
      ],
      packageMap: new Map(),
    });

    const wg = makeWorkspaceFixture();
    const cache = makeWorkspaceCache(wg);

    const data = parse(await handleAnalyze(cache, { root: ROOT, entryPoints: [] })) as {
      monorepoType: string;
      packageCount: number;
    };

    expect(data.monorepoType).toBe("pnpm");
    expect(data.packageCount).toBe(2);

    // Restore mock for other tests
    vi.mocked(detectMonorepo).mockReturnValue({
      type: "none",
      types: [],
      packages: [],
      packageMap: new Map(),
      root: ROOT,
    });
  });

  test("falls through to single-package build when entryPoints are provided", async () => {
    const cache = makeCache();
    const data = parse(await handleAnalyze(cache, { root: ROOT, entryPoints: ["src/a.ts"] })) as {
      nodeCount: number;
    };
    expect(data.nodeCount).toBe(3);
  });
});

describe("handleGetWorkspacePackages", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns package list with node counts and dependencies", async () => {
    const wg = makeWorkspaceFixture();
    const cache = makeWorkspaceCache(wg);

    const data = parse(await handleGetWorkspacePackages(cache, { root: ROOT })) as {
      monorepoType: string;
      packageCount: number;
      packages: Array<{ name: string; nodeCount: number; dependsOn: string[] }>;
    };

    expect(data.monorepoType).toBe("pnpm");
    expect(data.packageCount).toBe(2);

    const shared = data.packages.find(
      (p) => p.name === "@org/shared",
    ) as (typeof data.packages)[number];
    const app = data.packages.find((p) => p.name === "@org/app") as (typeof data.packages)[number];

    expect(shared.nodeCount).toBe(1);
    expect(shared.dependsOn).toEqual([]);
    expect(app.nodeCount).toBe(1);
    expect(app.dependsOn).toContain("@org/shared");
  });
});

describe("handleGetWorkspaceAffected", {
  tags: [
    "Graph",
    "SerializedGraph",
    "SessionState",
    "WorkspaceGraph",
    "cache",
    "graph",
    "handleAnalyze",
    "handleDetectFeatures",
    "handleFindUnused",
    "handleGetAffected",
    "handleGetDependencies",
    "handleGetDependents",
    "handleGetWorkspaceAffected",
    "handleGetWorkspacePackages",
    "handleProposeTags",
    "handleQuery",
    "handlers",
    "workspace-model",
  ],
}, () => {
  test("returns cross-package affected files", async () => {
    const wg = makeWorkspaceFixture();
    const cache = makeWorkspaceCache(wg);

    const data = parse(
      await handleGetWorkspaceAffected(cache, {
        root: ROOT,
        file: "packages/shared/src/utils.ts",
      }),
    ) as {
      affected: Array<{ file: string; package: string }>;
      count: number;
    };

    expect(data.count).toBeGreaterThan(0);
    const appEntry = data.affected.find((a) => a.file === "packages/app/src/page.ts");
    expect(appEntry?.package).toBe("@org/app");
  });

  test("returns empty affected for an unknown file", async () => {
    const wg = makeWorkspaceFixture();
    const cache = makeWorkspaceCache(wg);

    const data = parse(
      await handleGetWorkspaceAffected(cache, { root: ROOT, file: "nonexistent/file.ts" }),
    ) as { count: number };

    expect(data.count).toBe(0);
  });
});
