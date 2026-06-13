import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { npmDetector } from "./npm";
import { nxDetector } from "./nx";
import { pnpmDetector } from "./pnpm";
import { turborepoDetector } from "./turborepo";
import { yarnDetector } from "./yarn";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-det-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── pnpm ─────────────────────────────────────────────────────────────────────

describe("pnpmDetector", () => {
  test("returns null when pnpm-workspace.yaml is absent", () => {
    expect(pnpmDetector.detect(root)).toBeNull();
  });

  test("returns packages listed in pnpm-workspace.yaml", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    const pkgs = pnpmDetector.detect(root);
    expect(pkgs).not.toBeNull();
    expect(pkgs?.map((p) => p.name)).toContain("@org/a");
  });

  test("returns null when yaml is malformed", () => {
    write("pnpm-workspace.yaml", ": bad: yaml: {{{}}}");
    // js-yaml may throw — expect null (caught internally)
    const result = pnpmDetector.detect(root);
    // Either null or empty — not throwing
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  test("returns empty array when no patterns match existing dirs", () => {
    write("pnpm-workspace.yaml", "packages:\n  - nonexistent/*\n");
    const pkgs = pnpmDetector.detect(root);
    expect(pkgs).toEqual([]);
  });
});

// ─── npm ──────────────────────────────────────────────────────────────────────

describe("npmDetector", () => {
  test("returns null when package.json is absent", () => {
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json has no workspaces field", () => {
    write("package.json", JSON.stringify({ name: "root" }));
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("returns null when yarn.lock is present (defers to yarn detector)", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("resolves packages from array workspaces field", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    const pkgs = npmDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("@org/a");
  });

  test("resolves packages from object workspaces.packages field", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: { packages: ["apps/*"] } }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));
    const pkgs = npmDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("web");
  });
});

// ─── yarn ─────────────────────────────────────────────────────────────────────

describe("yarnDetector", () => {
  test("returns null when yarn.lock is absent", () => {
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json is absent", () => {
    write("yarn.lock", "");
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json has no workspaces field", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root" }));
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("resolves packages from yarn workspaces", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "pkg-a" }));
    const pkgs = yarnDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("pkg-a");
  });
});

// ─── nx ───────────────────────────────────────────────────────────────────────

describe("nxDetector", () => {
  test("returns null when nx.json is absent", () => {
    expect(nxDetector.detect(root)).toBeNull();
  });

  test("discovers packages with project.json files", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web" }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("web");
  });

  test("discovers integrated-style projects (no package.json, name from project.json)", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("libs/ui/project.json", JSON.stringify({ name: "@org/ui" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("@org/ui");
  });

  test("skips node_modules and dot directories", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("node_modules/some-pkg/project.json", JSON.stringify({ name: "should-skip" }));
    write(".nx/cache/project.json", JSON.stringify({ name: "also-skip" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).not.toContain("should-skip");
    expect(pkgs?.map((p) => p.name)).not.toContain("also-skip");
  });

  test("prefers package.json name over project.json name", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web-proj" }));
    write("apps/web/package.json", JSON.stringify({ name: "@org/web" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.[0]?.name).toBe("@org/web");
  });

  test("uses targets.build.options.main as entry point when present", () => {
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
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.[0]?.entryPoints[0]).toContain("index.ts");
  });
});

// ─── turborepo ────────────────────────────────────────────────────────────────

describe("turborepoDetector", () => {
  test("returns null when turbo.json is absent", () => {
    expect(turborepoDetector.detect(root)).toBeNull();
  });

  test("returns empty array when turbo.json is present (no packages — defers to other detectors)", () => {
    write("turbo.json", JSON.stringify({ pipeline: {} }));
    const pkgs = turborepoDetector.detect(root);
    expect(pkgs).toEqual([]);
  });
});
