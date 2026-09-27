import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Graph, getAllProjectFiles, WorkspaceGraph } from "../../index";
import type { FileNode } from "../../types/node";
import { clearWorkspaceCache, loadWorkspaceCache, saveWorkspaceCache } from "./disk-cache";

function makeNode(p: string): FileNode {
  return {
    path: p,
    type: "typescript",
    category: "logic",
    imports: [],
    exports: [],
    tags: [],
    mtime: 1000,
    size: 100,
  };
}

/** A two-package workspace (`packages/a`, `packages/b`) with the given files actually written to
 *  disk under `root`, so `computeWorkspacePackageDigests` stats real files. */
function scaffold(root: string): WorkspaceGraph {
  for (const rel of ["packages/a/index.ts", "packages/a/util.ts", "packages/b/index.ts"]) {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), `// ${rel}\n`);
  }
  const wg = new WorkspaceGraph(root, "pnpm");
  wg.addPackage(
    {
      name: "@scope/a",
      root: path.join(root, "packages/a"),
      relativeRoot: "packages/a",
      entryPoints: [],
    },
    new Graph(
      new Map([
        ["packages/a/index.ts", makeNode("packages/a/index.ts")],
        ["packages/a/util.ts", makeNode("packages/a/util.ts")],
      ]),
    ),
  );
  wg.addPackage(
    {
      name: "@scope/b",
      root: path.join(root, "packages/b"),
      relativeRoot: "packages/b",
      entryPoints: [],
    },
    new Graph(new Map([["packages/b/index.ts", makeNode("packages/b/index.ts")]])),
  );
  return wg;
}

const subdir = (root: string) => path.join(root, "mokosh-cache", "workspace");

describe("workspace disk-cache", { tags: ["workspace", "cache", "mcp"] }, () => {
  let root: string;
  let cacheDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-diskcache-"));
    cacheDir = path.join(root, "mokosh-cache");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("round-trips: save writes a manifest + one file per package, load rebuilds the graph", () => {
    const wg = scaffold(root);
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), wg);

    expect(fs.existsSync(path.join(subdir(root), "manifest.json"))).toBe(true);
    const pkgFiles = fs.readdirSync(subdir(root)).filter((f) => f !== "manifest.json");
    expect(pkgFiles).toHaveLength(2);

    const loaded = loadWorkspaceCache(cacheDir, getAllProjectFiles(root));
    expect(loaded).not.toBeNull();
    expect([...(loaded as WorkspaceGraph).packages.keys()].sort()).toEqual([
      "@scope/a",
      "@scope/b",
    ]);
    expect((loaded as WorkspaceGraph).packages.get("@scope/a")?.graph.nodes.size).toBe(2);
  });

  test("returns null when a package's own source file changed (per-package digest)", () => {
    const wg = scaffold(root);
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), wg);

    fs.writeFileSync(path.join(root, "packages/a/util.ts"), "// changed\nexport const x = 1;\n");
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("returns null when a root-level (non-package) file changed (rootDigest)", () => {
    const wg = scaffold(root);
    // A scanned source file that sits under no package → counted in `rootDigest`.
    fs.writeFileSync(path.join(root, "root.config.ts"), "export default {};\n");
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), wg);

    fs.writeFileSync(path.join(root, "root.config.ts"), "export default { changed: true };\n");
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("an unrelated package changing does not invalidate — but load is still all-or-nothing", () => {
    // `@scope/b` file changes: its per-package digest moves, so the whole cache is discarded.
    const wg = scaffold(root);
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), wg);
    fs.writeFileSync(path.join(root, "packages/b/index.ts"), "// b changed\n");
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("returns null on a corrupt manifest", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    fs.writeFileSync(path.join(subdir(root), "manifest.json"), "{ not json");
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("returns null on a manifest version bump", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    const p = path.join(subdir(root), "manifest.json");
    const m = JSON.parse(fs.readFileSync(p, "utf-8"));
    m.version = 999;
    fs.writeFileSync(p, JSON.stringify(m));
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("returns null when a package file referenced by the manifest is missing", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    const pkgFile = fs.readdirSync(subdir(root)).find((f) => f !== "manifest.json") as string;
    fs.rmSync(path.join(subdir(root), pkgFile));
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("re-saving with a different package set removes the orphaned package file", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    expect(fs.readdirSync(subdir(root)).filter((f) => f !== "manifest.json")).toHaveLength(2);

    const smaller = new WorkspaceGraph(root, "pnpm");
    smaller.addPackage(
      {
        name: "@scope/a",
        root: path.join(root, "packages/a"),
        relativeRoot: "packages/a",
        entryPoints: [],
      },
      new Graph(new Map([["packages/a/index.ts", makeNode("packages/a/index.ts")]])),
    );
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), smaller);

    expect(fs.readdirSync(subdir(root)).filter((f) => f !== "manifest.json")).toHaveLength(1);
  });

  test("deletes a legacy single-blob workspace-graph.json on save", () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "workspace-graph.json"), '{"stale":true}');
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    expect(fs.existsSync(path.join(cacheDir, "workspace-graph.json"))).toBe(false);
  });

  test("returns null (no throw) when the cache dir does not exist", () => {
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });
});

describe("clearWorkspaceCache", { tags: ["workspace", "cache", "mcp"] }, () => {
  let root: string;
  let cacheDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-diskcache-clear-"));
    cacheDir = path.join(root, "mokosh-cache");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("removes the workspace subdirectory so a subsequent load is a guaranteed miss", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    expect(fs.existsSync(subdir(root))).toBe(true);

    clearWorkspaceCache(cacheDir);

    expect(fs.existsSync(subdir(root))).toBe(false);
    expect(loadWorkspaceCache(cacheDir, getAllProjectFiles(root))).toBeNull();
  });

  test("is a no-op (never throws) when nothing was cached yet", () => {
    expect(() => clearWorkspaceCache(cacheDir)).not.toThrow();
  });

  test("leaves the rest of mokosh-cache/ (e.g. graph.json) untouched", () => {
    saveWorkspaceCache(cacheDir, getAllProjectFiles(root), scaffold(root));
    fs.writeFileSync(path.join(cacheDir, "graph.json"), '{"nodes":[]}');

    clearWorkspaceCache(cacheDir);

    expect(fs.existsSync(subdir(root))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, "graph.json"))).toBe(true);
  });
});
