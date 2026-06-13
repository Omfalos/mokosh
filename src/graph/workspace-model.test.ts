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

describe("getPackageForFile", () => {
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

describe("getPackageDependencies", () => {
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

describe("getAffectedAcrossPackages", () => {
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

// ─── serialize / deserialize ──────────────────────────────────────────────────

describe("serialize / deserialize", () => {
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
