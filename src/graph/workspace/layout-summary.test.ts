import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Graph } from "../model";
import { WorkspaceGraph } from "../workspace-model";
import { summarizeWorkspaceLayout } from "./layout-summary";
import type { MonorepoLayout } from "./types";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-layout-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function jsLayout(): MonorepoLayout {
  const packages = [
    {
      name: "@org/shared",
      root: path.join(root, "packages/shared"),
      relativeRoot: "packages/shared",
      entryPoints: [],
    },
    {
      name: "@org/app",
      root: path.join(root, "packages/app"),
      relativeRoot: "packages/app",
      entryPoints: [],
    },
  ];
  return {
    root,
    type: "pnpm",
    types: ["pnpm"],
    packages,
    packageMap: new Map(packages.map((pkg) => [pkg.name, pkg])),
  };
}

describe("summarizeWorkspaceLayout", { tags: ["workspace", "layout-summary"] }, () => {
  test("derives dependsOn from package.json manifests without a graph", () => {
    write("packages/shared/package.json", JSON.stringify({ name: "@org/shared" }));
    write(
      "packages/app/package.json",
      JSON.stringify({
        name: "@org/app",
        dependencies: { "@org/shared": "workspace:*", lodash: "^4" },
      }),
    );

    const summary = summarizeWorkspaceLayout(jsLayout());

    expect(summary.monorepoType).toBe("pnpm");
    expect(summary.packageCount).toBe(2);
    expect(summary.nodeCountsResolved).toBe(false);
    expect(summary.dependsOnResolved).toBe(true);
    expect(summary.packages.find((p) => p.name === "@org/app")?.dependsOn).toEqual(["@org/shared"]);
    expect(summary.packages.find((p) => p.name === "@org/shared")?.dependsOn).toEqual([]);
    expect(summary.packages[0]?.nodeCount).toBeUndefined();
    expect(summary.note).toBeDefined();
  });

  test("flags dependsOnResolved=false when a package has no readable manifest", () => {
    write("packages/app/package.json", JSON.stringify({ name: "@org/app" }));
    // packages/shared has no package.json (e.g. a JVM module)

    const summary = summarizeWorkspaceLayout(jsLayout());

    expect(summary.dependsOnResolved).toBe(false);
  });

  test("uses exact node counts and edges from a built workspace graph", () => {
    const sharedGraph = new Graph(
      new Map([
        [
          "packages/shared/src/a.ts",
          {
            path: "packages/shared/src/a.ts",
            type: "typescript",
            category: "logic",
            imports: [],
            exports: [],
            tags: [],
            mtime: 0,
            size: 0,
          },
        ],
      ]),
    );
    const appGraph = new Graph(
      new Map([
        [
          "packages/app/src/b.ts",
          {
            path: "packages/app/src/b.ts",
            type: "typescript",
            category: "logic",
            imports: [
              {
                fromPath: "packages/app/src/b.ts",
                toPath: "packages/shared/src/a.ts",
                rawSpecifier: "@org/shared",
                isStyle: false,
                type: "static",
                isWorkspace: true,
                workspacePackage: "@org/shared",
              },
            ],
            exports: [],
            tags: [],
            mtime: 0,
            size: 0,
          },
        ],
      ]),
    );
    const wg = new WorkspaceGraph(root, "pnpm");
    wg.addPackage(
      { name: "@org/shared", root: "", relativeRoot: "packages/shared", entryPoints: [] },
      sharedGraph,
    );
    wg.addPackage(
      { name: "@org/app", root: "", relativeRoot: "packages/app", entryPoints: [] },
      appGraph,
    );

    const summary = summarizeWorkspaceLayout(jsLayout(), wg);

    expect(summary.nodeCountsResolved).toBe(true);
    expect(summary.dependsOnResolved).toBe(true);
    expect(summary.note).toBeUndefined();
    expect(summary.packages.find((p) => p.name === "@org/app")?.nodeCount).toBe(1);
    expect(summary.packages.find((p) => p.name === "@org/app")?.dependsOn).toContain("@org/shared");
  });
});
