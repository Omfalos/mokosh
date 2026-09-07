import { describe, expect, test } from "vitest";
import type { FileNode } from "../types/node";
import { Graph } from "./model";
import type { WorkspacePackage } from "./workspace";
import { WorkspaceGraph } from "./workspace-model";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<FileNode> & { path: string }): FileNode {
  return {
    type: "typescript",
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
    ...overrides,
  };
}

function makePkg(name: string, relativeRoot: string): WorkspacePackage {
  return { name, root: `/mono/${relativeRoot}`, relativeRoot, entryPoints: [] };
}

function makeGraph(nodes: FileNode[]): Graph {
  return new Graph(new Map(nodes.map((n) => [n.path, n])));
}

// Two-package fixture:
//   packages/shared/src/utils.ts  (exported by @org/shared)
//   packages/app/src/page.ts      (imports @org/shared via workspace edge)
function makeTwoPackageWorkspace(): WorkspaceGraph {
  const sharedUtils = makeNode({ path: "packages/shared/src/utils.ts" });
  const sharedGraph = makeGraph([sharedUtils]);

  const appPage = makeNode({
    path: "packages/app/src/page.ts",
    imports: [
      {
        fromPath: "packages/app/src/page.ts",
        toPath: "packages/shared/src/utils.ts",
        rawSpecifier: "@org/shared",
        isStyle: false,
        type: "static",
        isWorkspace: true,
        workspacePackage: "@org/shared",
      },
    ],
  });
  const appGraph = makeGraph([appPage]);

  const wg = new WorkspaceGraph("/mono", "pnpm");
  wg.addPackage(makePkg("@org/shared", "packages/shared"), sharedGraph);
  wg.addPackage(makePkg("@org/app", "packages/app"), appGraph);
  return wg;
}

// ─── getPackageForFile ────────────────────────────────────────────────────────

describe("getPackageForFile", {
  tags: [
    "FileNode",
    "Graph",
    "WorkspaceGraph",
    "WorkspacePackage",
    "model",
    "node",
    "workspace-model",
  ],
}, () => {
  test("returns the owning package for a file path", () => {
    const wg = makeTwoPackageWorkspace();
    const pkg = wg.getPackageForFile("packages/shared/src/utils.ts");
    expect(pkg?.name).toBe("@org/shared");
  });

  test("returns undefined for an unrecognised path", () => {
    const wg = makeTwoPackageWorkspace();
    expect(wg.getPackageForFile("unknown/file.ts")).toBeUndefined();
  });

  test("matches exact relativeRoot path", () => {
    const wg = makeTwoPackageWorkspace();
    const pkg = wg.getPackageForFile("packages/app");
    expect(pkg?.name).toBe("@org/app");
  });
});

// ─── getPackageDependencies ───────────────────────────────────────────────────

describe("getPackageDependencies", {
  tags: [
    "FileNode",
    "Graph",
    "WorkspaceGraph",
    "WorkspacePackage",
    "model",
    "node",
    "workspace-model",
  ],
}, () => {
  test("returns workspace-level dependency map", () => {
    const wg = makeTwoPackageWorkspace();
    const deps = wg.getPackageDependencies();
    expect(deps.get("@org/app")).toContain("@org/shared");
    expect(deps.get("@org/shared")).toEqual([]);
  });

  test("returns empty arrays for packages with no workspace imports", () => {
    const wg = new WorkspaceGraph("/mono", "npm");
    wg.addPackage(
      makePkg("standalone", "packages/standalone"),
      makeGraph([makeNode({ path: "packages/standalone/index.ts" })]),
    );
    const deps = wg.getPackageDependencies();
    expect(deps.get("standalone")).toEqual([]);
  });
});

// ─── getAffectedAcrossPackages ────────────────────────────────────────────────

describe("getAffectedAcrossPackages", {
  tags: [
    "FileNode",
    "Graph",
    "WorkspaceGraph",
    "WorkspacePackage",
    "model",
    "node",
    "workspace-model",
  ],
}, () => {
  test("returns cross-package files affected by a shared utility change", () => {
    const wg = makeTwoPackageWorkspace();
    const affected = wg.getAffectedAcrossPackages("packages/shared/src/utils.ts");

    const files = affected.map((a) => a.file);
    expect(files).toContain("packages/app/src/page.ts");
  });

  test("annotates each result with its package name", () => {
    const wg = makeTwoPackageWorkspace();
    const affected = wg.getAffectedAcrossPackages("packages/shared/src/utils.ts");
    const appEntry = affected.find((a) => a.file === "packages/app/src/page.ts");
    expect(appEntry?.package).toBe("@org/app");
  });

  test("returns empty array for an unrecognised file", () => {
    const wg = makeTwoPackageWorkspace();
    const affected = wg.getAffectedAcrossPackages("packages/nonexistent/file.ts");
    expect(affected).toEqual([]);
  });

  test("includes intra-package dependents alongside cross-package ones", () => {
    // shared has two files: utils.ts and helper.ts; helper imports utils
    const utils = makeNode({ path: "packages/shared/src/utils.ts" });
    const helper = makeNode({
      path: "packages/shared/src/helper.ts",
      imports: [
        {
          fromPath: "packages/shared/src/helper.ts",
          toPath: "packages/shared/src/utils.ts",
          rawSpecifier: "./utils",
          isStyle: false,
          type: "static",
        },
      ],
    });
    const sharedGraph = makeGraph([utils, helper]);

    const appPage = makeNode({
      path: "packages/app/src/page.ts",
      imports: [
        {
          fromPath: "packages/app/src/page.ts",
          toPath: "packages/shared/src/utils.ts",
          rawSpecifier: "@org/shared",
          isStyle: false,
          type: "static",
          isWorkspace: true,
          workspacePackage: "@org/shared",
        },
      ],
    });
    const appGraph = makeGraph([appPage]);

    const wg = new WorkspaceGraph("/mono", "pnpm");
    wg.addPackage(makePkg("@org/shared", "packages/shared"), sharedGraph);
    wg.addPackage(makePkg("@org/app", "packages/app"), appGraph);

    const affected = wg.getAffectedAcrossPackages("packages/shared/src/utils.ts");
    const files = affected.map((a) => a.file);

    expect(files).toContain("packages/shared/src/helper.ts");
    expect(files).toContain("packages/app/src/page.ts");
  });
});

// ─── summarizeAffectedAcrossPackages ─────────────────────────────────────────

describe("summarizeAffectedAcrossPackages", {
  tags: ["FileNode", "Graph", "WorkspaceGraph", "WorkspacePackage", "workspace-model"],
}, () => {
  // shared package where helper.ts and two more files all import utils.ts,
  // plus app/page.ts importing shared across the package boundary.
  function makeWide(): WorkspaceGraph {
    const utils = makeNode({ path: "packages/shared/src/utils.ts" });
    const dependents = ["helper", "b", "c", "d"].map((name) =>
      makeNode({
        path: `packages/shared/src/${name}.ts`,
        imports: [
          {
            fromPath: `packages/shared/src/${name}.ts`,
            toPath: "packages/shared/src/utils.ts",
            rawSpecifier: "./utils",
            isStyle: false,
            type: "static",
          },
        ],
      }),
    );
    const appPage = makeNode({
      path: "packages/app/src/page.ts",
      imports: [
        {
          fromPath: "packages/app/src/page.ts",
          toPath: "packages/shared/src/utils.ts",
          rawSpecifier: "@org/shared",
          isStyle: false,
          type: "static",
          isWorkspace: true,
          workspacePackage: "@org/shared",
        },
      ],
    });
    const wg = new WorkspaceGraph("/mono", "pnpm");
    wg.addPackage(makePkg("@org/shared", "packages/shared"), makeGraph([utils, ...dependents]));
    wg.addPackage(makePkg("@org/app", "packages/app"), makeGraph([appPage]));
    return wg;
  }

  test("groups the blast radius by package, sorted by count desc", () => {
    const summary = makeWide().summarizeAffectedAcrossPackages("packages/shared/src/utils.ts");
    expect(summary.totalAffected).toBe(5);
    expect(summary.packageCount).toBe(2);
    expect(summary.byPackage[0]?.package).toBe("@org/shared");
    expect(summary.byPackage[0]?.count).toBe(4);
    expect(summary.byPackage[1]?.package).toBe("@org/app");
  });

  test("caps each package's sample and reports the remainder + truncated flag", () => {
    const summary = makeWide().summarizeAffectedAcrossPackages("packages/shared/src/utils.ts", {
      maxFilesPerPackage: 2,
    });
    const shared = summary.byPackage.find((g) => g.package === "@org/shared");
    expect(shared?.sample).toHaveLength(2);
    expect(shared?.more).toBe(2);
    expect(summary.truncated).toBe(true);
  });

  test("maxFilesPerPackage: 0 returns counts only, no samples", () => {
    const summary = makeWide().summarizeAffectedAcrossPackages("packages/shared/src/utils.ts", {
      maxFilesPerPackage: 0,
    });
    expect(summary.byPackage.every((g) => g.sample.length === 0)).toBe(true);
    expect(summary.truncated).toBe(true);
  });

  test("zero totals for an unknown file", () => {
    const summary = makeWide().summarizeAffectedAcrossPackages("nope/x.ts");
    expect(summary).toMatchObject({
      totalAffected: 0,
      packageCount: 0,
      byPackage: [],
      truncated: false,
    });
  });
});

// ─── flatten ─────────────────────────────────────────────────────────────────

describe("flatten", {
  tags: ["FileNode", "Graph", "WorkspaceGraph", "WorkspacePackage", "workspace-model"],
}, () => {
  test("merges every package's own nodes into one namespace with a packageOf lookup", () => {
    const wg = makeTwoPackageWorkspace();
    const { graph, packageOf } = wg.flatten();

    expect([...graph.nodes.keys()].sort()).toEqual([
      "packages/app/src/page.ts",
      "packages/shared/src/utils.ts",
    ]);
    expect(packageOf.get("packages/shared/src/utils.ts")).toBe("@org/shared");
    expect(packageOf.get("packages/app/src/page.ts")).toBe("@org/app");
  });

  test("drops borrowed cross-package nodes so a shared file is not double-counted", () => {
    const wg = makeTwoPackageWorkspace();
    // Simulate the app package graph carrying a borrowed copy of the shared file.
    const appEntry = wg.packages.get("@org/app");
    appEntry?.graph.nodes.set(
      "packages/shared/src/utils.ts",
      makeNode({ path: "packages/shared/src/utils.ts", size: 999 }),
    );

    const { graph, packageOf } = wg.flatten();
    // Only one node for the shared file, owned by @org/shared (not the borrowed size:999 copy).
    expect(graph.nodes.get("packages/shared/src/utils.ts")?.size).toBe(0);
    expect(packageOf.get("packages/shared/src/utils.ts")).toBe("@org/shared");
  });

  test("keeps cross-package import edges traversable", () => {
    const wg = makeTwoPackageWorkspace();
    const { graph } = wg.flatten();

    const reached: string[] = [];
    graph.traverse(
      "packages/shared/src/utils.ts",
      (node) => {
        reached.push(node.path);
        return true;
      },
      { direction: "incoming" },
    );
    expect(reached).toContain("packages/app/src/page.ts");
  });

  test("is memoized — repeated calls return the same instance", () => {
    const wg = makeTwoPackageWorkspace();
    expect(wg.flatten()).toBe(wg.flatten());
  });
});

// ─── annotateCrossPackageEdges ───────────────────────────────────────────────

describe("annotateCrossPackageEdges", {
  tags: ["FileNode", "Graph", "WorkspaceGraph", "WorkspacePackage", "workspace-model"],
}, () => {
  // JVM-style fixture: a plain local edge (no isWorkspace) whose target lives in another package.
  function makeJvmWorkspace(): WorkspaceGraph {
    const repo = makeNode({ path: "core/data/src/main/kotlin/Repo.kt", type: "kotlin" });
    const app = makeNode({
      path: "app/src/main/kotlin/App.kt",
      type: "kotlin",
      imports: [
        {
          fromPath: "app/src/main/kotlin/App.kt",
          toPath: "core/data/src/main/kotlin/Repo.kt",
          rawSpecifier: "core.data.Repo",
          isStyle: false,
          type: "static",
        },
      ],
    });
    const wg = new WorkspaceGraph("/mono", "gradle");
    wg.addPackage(makePkg("app", "app"), makeGraph([app]));
    wg.addPackage(makePkg("core:data", "core/data"), makeGraph([repo]));
    return wg;
  }

  test("tags a cross-package local edge as a workspace edge", () => {
    const wg = makeJvmWorkspace();
    wg.annotateCrossPackageEdges();

    const { graph } = wg.packages.get("app") as { graph: Graph; pkg: WorkspacePackage };
    const edge = (graph.nodes.get("app/src/main/kotlin/App.kt") as FileNode).imports[0];
    expect(edge?.isWorkspace).toBe(true);
    expect(edge?.workspacePackage).toBe("core:data");
  });

  test("feeds getPackageDependencies and getAffectedAcrossPackages", () => {
    const wg = makeJvmWorkspace();
    wg.annotateCrossPackageEdges();

    expect(wg.getPackageDependencies().get("app")).toEqual(["core:data"]);
    const affected = wg.getAffectedAcrossPackages("core/data/src/main/kotlin/Repo.kt");
    expect(affected.map((a) => a.file)).toContain("app/src/main/kotlin/App.kt");
  });

  test("leaves intra-package and external edges untouched", () => {
    const helper = makeNode({ path: "app/src/main/kotlin/Helper.kt", type: "kotlin" });
    const app = makeNode({
      path: "app/src/main/kotlin/App.kt",
      type: "kotlin",
      imports: [
        {
          fromPath: "app/src/main/kotlin/App.kt",
          toPath: "app/src/main/kotlin/Helper.kt",
          rawSpecifier: "app.Helper",
          isStyle: false,
          type: "static",
        },
        {
          fromPath: "app/src/main/kotlin/App.kt",
          toPath: "com.google.gson",
          rawSpecifier: "com.google.gson.Gson",
          isStyle: false,
          type: "static",
          isExternal: true,
        },
      ],
    });
    const wg = new WorkspaceGraph("/mono", "gradle");
    wg.addPackage(makePkg("app", "app"), makeGraph([app, helper]));
    wg.annotateCrossPackageEdges();

    const edges = (wg.packages.get("app") as { graph: Graph }).graph.nodes.get(
      "app/src/main/kotlin/App.kt",
    )?.imports;
    expect(edges?.[0]?.isWorkspace).toBeUndefined();
    expect(edges?.[1]?.isWorkspace).toBeUndefined();
  });

  test("does not overwrite an edge already tagged by a JS resolver", () => {
    const wg = makeTwoPackageWorkspace();
    wg.annotateCrossPackageEdges();
    const edge = (wg.packages.get("@org/app") as { graph: Graph }).graph.nodes.get(
      "packages/app/src/page.ts",
    )?.imports[0];
    expect(edge?.workspacePackage).toBe("@org/shared");
  });
});

// ─── serialize / deserialize ──────────────────────────────────────────────────

describe("serialize / deserialize", {
  tags: [
    "FileNode",
    "Graph",
    "WorkspaceGraph",
    "WorkspacePackage",
    "model",
    "node",
    "workspace-model",
  ],
}, () => {
  test("round-trips the workspace graph", () => {
    const wg = makeTwoPackageWorkspace();
    const serialized = wg.serialize();
    const restored = WorkspaceGraph.deserialize(serialized);

    expect(restored.monorepoRoot).toBe(wg.monorepoRoot);
    expect(restored.type).toBe(wg.type);
    expect(restored.packages.size).toBe(2);
    expect(restored.packages.has("@org/shared")).toBe(true);
    expect(restored.packages.has("@org/app")).toBe(true);
  });

  test("restored graph preserves workspace import edges", () => {
    const wg = makeTwoPackageWorkspace();
    const restored = WorkspaceGraph.deserialize(wg.serialize());

    const { graph } = restored.packages.get("@org/app") as { graph: Graph; pkg: WorkspacePackage };
    const page = graph.nodes.get("packages/app/src/page.ts") as FileNode;
    const wsEdge = page.imports.find((i) => i.isWorkspace);

    expect(wsEdge?.workspacePackage).toBe("@org/shared");
  });

  test("getAffectedAcrossPackages works on a deserialized graph", () => {
    const wg = makeTwoPackageWorkspace();
    const restored = WorkspaceGraph.deserialize(wg.serialize());

    const affected = restored.getAffectedAcrossPackages("packages/shared/src/utils.ts");
    expect(affected.map((a) => a.file)).toContain("packages/app/src/page.ts");
  });
});
