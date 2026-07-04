import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectMonorepo, type WorkspacePackage } from "./workspace";

// ─── helpers ─────────────────────────────────────────────────────────────────

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── pnpm ─────────────────────────────────────────────────────────────────────

describe("pnpm workspaces", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("detects pnpm type from pnpm-workspace.yaml", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    write("packages/a/src/index.ts", "");
    write("packages/b/package.json", JSON.stringify({ name: "@org/b" }));
    write("packages/b/src/index.ts", "");

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("pnpm");
    expect(layout.packages).toHaveLength(2);
    expect(layout.packages.map((p) => p.name).sort()).toEqual(["@org/a", "@org/b"]);
  });

  test("populates root, relativeRoot, and entryPoints", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    write("packages/a/src/index.ts", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.root).toBe(path.join(root, "packages/a"));
    expect(pkg.relativeRoot).toBe("packages/a");
    expect(pkg.entryPoints.length).toBeGreaterThan(0);
    expect(pkg.entryPoints[0]).toContain("index.ts");
  });

  test("builds packageMap keyed by package name", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));

    const layout = detectMonorepo(root);

    expect(layout.packageMap.has("@org/a")).toBe(true);
  });

  test("skips directories without package.json", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    fs.mkdirSync(path.join(root, "packages/no-pkg-json"), { recursive: true });

    const layout = detectMonorepo(root);

    expect(layout.packages).toHaveLength(1);
  });

  test("returns none when pnpm-workspace.yaml lists no matching dirs", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    // no packages dir created

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("pnpm");
    expect(layout.packages).toHaveLength(0);
  });
});

// ─── npm workspaces ───────────────────────────────────────────────────────────

describe("npm workspaces", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("detects npm type from package.json workspaces array", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/ui/package.json", JSON.stringify({ name: "@org/ui" }));
    write("packages/core/package.json", JSON.stringify({ name: "@org/core" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("npm");
    expect(layout.packages).toHaveLength(2);
  });

  test("handles workspaces.packages object form", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: { packages: ["apps/*"] } }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("npm");
    expect(layout.packages).toHaveLength(1);
    expect(layout.packages[0]?.name).toBe("web");
  });

  test("returns none when package.json has no workspaces field", () => {
    write("package.json", JSON.stringify({ name: "root" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("none");
  });
});

// ─── yarn workspaces ──────────────────────────────────────────────────────────

describe("yarn workspaces", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("detects yarn type when yarn.lock present alongside workspaces", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "pkg-a" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("yarn");
    expect(layout.packages).toHaveLength(1);
  });
});

// ─── Nx ───────────────────────────────────────────────────────────────────────

describe("Nx workspaces", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("detects nx type from nx.json and project.json files", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web" }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));
    write("libs/shared/project.json", JSON.stringify({ name: "shared" }));
    write("libs/shared/package.json", JSON.stringify({ name: "shared" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("nx");
    expect(layout.packages.map((p) => p.name).sort()).toEqual(["shared", "web"]);
  });

  test("integrated repo: projects without package.json are discovered via project.json name", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    // No package.json — integrated monorepo style
    write("libs/ui/project.json", JSON.stringify({ name: "@org/ui", sourceRoot: "libs/ui/src" }));
    write("libs/ui/src/index.ts", "");

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("nx");
    expect(layout.packages).toHaveLength(1);
    expect(layout.packages[0]?.name).toBe("@org/ui");
  });

  test("uses targets.build.options.main as the entry point", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write(
      "libs/core/project.json",
      JSON.stringify({
        name: "@org/core",
        sourceRoot: "libs/core/src",
        targets: { build: { options: { main: "libs/core/src/index.ts" } } },
      }),
    );
    write("libs/core/src/index.ts", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.entryPoints[0]).toContain("libs/core/src/index.ts");
  });

  test("falls back to sourceRoot/index.ts when no build target main is set", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write(
      "libs/utils/project.json",
      JSON.stringify({ name: "@org/utils", sourceRoot: "libs/utils/src" }),
    );
    write("libs/utils/src/index.ts", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.entryPoints[0]).toContain("index.ts");
  });

  test("package-based: prefers package.json name over project.json name", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web-proj" }));
    write("apps/web/package.json", JSON.stringify({ name: "@org/web" }));

    const layout = detectMonorepo(root);

    expect(layout.packages[0]?.name).toBe("@org/web");
  });
});

// ─── Turborepo ────────────────────────────────────────────────────────────────

describe("Turborepo", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("detects turborepo type and pnpm alongside it", () => {
    write("turbo.json", JSON.stringify({ pipeline: {} }));
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/api/package.json", JSON.stringify({ name: "api" }));

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("turborepo");
    expect(layout.types).toContain("turborepo");
    expect(layout.types).toContain("pnpm");
    expect(layout.packages).toHaveLength(1);
    expect(layout.packages[0]?.name).toBe("api");
  });

  test("turborepo + yarn: both types reported, packages from yarn", () => {
    write("turbo.json", JSON.stringify({ pipeline: {} }));
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/web/package.json", JSON.stringify({ name: "web" }));

    const layout = detectMonorepo(root);

    expect(layout.types).toContain("turborepo");
    expect(layout.types).toContain("yarn");
    expect(layout.packages).toHaveLength(1);
  });
});

// ─── none ─────────────────────────────────────────────────────────────────────

describe("no monorepo", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("returns type none for a plain project directory", () => {
    write("src/index.ts", "");

    const layout = detectMonorepo(root);

    expect(layout.type).toBe("none");
    expect(layout.types).toEqual([]);
    expect(layout.packages).toHaveLength(0);
  });

  test("returns none for empty directory", () => {
    const layout = detectMonorepo(root);
    expect(layout.type).toBe("none");
    expect(layout.types).toEqual([]);
  });
});

// ─── hybrid detection ─────────────────────────────────────────────────────────

describe("hybrid monorepo detection", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("Nx + pnpm: both types reported, packages merged and deduplicated", () => {
    // Nx integrated repo that also uses pnpm workspaces
    write("nx.json", JSON.stringify({ version: 2 }));
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");

    // Shared package appears in both: pnpm glob AND nx project.json
    write("packages/shared/package.json", JSON.stringify({ name: "@org/shared" }));
    write("packages/shared/project.json", JSON.stringify({ name: "@org/shared" }));
    write("packages/shared/src/index.ts", "");

    // Nx-only project (no package.json, only project.json)
    write("libs/utils/project.json", JSON.stringify({ name: "@org/utils" }));
    write("libs/utils/src/index.ts", "");

    const layout = detectMonorepo(root);

    expect(layout.types).toContain("nx");
    expect(layout.types).toContain("pnpm");
    // @org/shared appears in both but should only be in packages once
    expect(layout.packages.filter((p) => p.name === "@org/shared")).toHaveLength(1);
    // @org/utils only from Nx
    expect(layout.packages.some((p) => p.name === "@org/utils")).toBe(true);
  });
});

// ─── entry point resolution ───────────────────────────────────────────────────

describe("entry point resolution", { tags: ["WorkspacePackage", "detectMonorepo"] }, () => {
  test("uses src/index.ts when present", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    write("packages/a/src/index.ts", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.entryPoints[0]).toBe(path.join(root, "packages/a/src/index.ts"));
  });

  test("uses package.json main field when no src/index.ts", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a", main: "dist/index.js" }));
    write("packages/a/dist/index.js", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.entryPoints[0]).toContain("dist/index.js");
  });

  test("uses package.json exports['.'] string when present", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write(
      "packages/a/package.json",
      JSON.stringify({ name: "@org/a", exports: { ".": "./src/index.ts" } }),
    );
    write("packages/a/src/index.ts", "");

    const layout = detectMonorepo(root);
    const pkg = layout.packages[0] as WorkspacePackage;

    expect(pkg.entryPoints[0]).toContain("src/index.ts");
  });
});
