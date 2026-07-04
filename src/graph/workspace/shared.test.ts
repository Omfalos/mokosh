import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPackage, resolveEntryPoints, resolveGlobPatterns } from "./shared";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-shared-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── buildPackage ─────────────────────────────────────────────────────────────

describe("buildPackage", {
  tags: ["buildPackage", "resolveEntryPoints", "resolveGlobPatterns"],
}, () => {
  test("returns null when package.json is absent", () => {
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });
    expect(buildPackage(root, path.join(root, "pkg"))).toBeNull();
  });

  test("returns null when package.json has no name field", () => {
    write("pkg/package.json", JSON.stringify({ version: "1.0.0" }));
    expect(buildPackage(root, path.join(root, "pkg"))).toBeNull();
  });

  test("returns null when package.json contains malformed JSON", () => {
    write("pkg/package.json", "not-json{{{");
    expect(buildPackage(root, path.join(root, "pkg"))).toBeNull();
  });

  test("returns a valid WorkspacePackage when package.json is present", () => {
    write("pkg/package.json", JSON.stringify({ name: "@org/pkg" }));
    const result = buildPackage(root, path.join(root, "pkg"));
    expect(result).not.toBeNull();
    expect(result?.name).toBe("@org/pkg");
    expect(result?.relativeRoot).toBe("pkg");
  });
});

// ─── resolveEntryPoints ───────────────────────────────────────────────────────

describe("resolveEntryPoints", {
  tags: ["buildPackage", "resolveEntryPoints", "resolveGlobPatterns"],
}, () => {
  test("prefers exports['.'] string over main", () => {
    write("pkg/src/index.ts", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), {
      exports: { ".": "./src/index.ts" },
      main: "dist/index.js",
    });
    expect(result[0]).toContain("src/index.ts");
  });

  test("resolves exports['.'] as object with import/require/default conditions", () => {
    write("pkg/src/index.ts", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), {
      exports: { ".": { import: "./src/index.ts" } },
    });
    expect(result[0]).toContain("src/index.ts");
  });

  test("resolves exports['.'] object with require condition", () => {
    write("pkg/dist/index.js", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), {
      exports: { ".": { require: "./dist/index.js" } },
    });
    expect(result[0]).toContain("dist/index.js");
  });

  test("resolves exports['.'] object with default condition", () => {
    write("pkg/dist/index.js", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), {
      exports: { ".": { default: "./dist/index.js" } },
    });
    expect(result[0]).toContain("dist/index.js");
  });

  test("falls back to main field when no exports", () => {
    write("pkg/dist/index.js", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), { main: "dist/index.js" });
    expect(result[0]).toContain("dist/index.js");
  });

  test("falls back to src/index.ts convention", () => {
    write("pkg/src/index.ts", "");
    const result = resolveEntryPoints(path.join(root, "pkg"), {});
    expect(result[0]).toContain("src/index.ts");
  });
});

// ─── resolveGlobPatterns ──────────────────────────────────────────────────────

describe("resolveGlobPatterns", {
  tags: ["buildPackage", "resolveEntryPoints", "resolveGlobPatterns"],
}, () => {
  test("resolves a single-star glob to immediate subdirectories", () => {
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    write("packages/b/package.json", JSON.stringify({ name: "@org/b" }));
    const result = resolveGlobPatterns(root, ["packages/*"]);
    expect(result.map((p) => p.name).sort()).toEqual(["@org/a", "@org/b"]);
  });

  test("skips directories without package.json", () => {
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    fs.mkdirSync(path.join(root, "packages/no-pkg"), { recursive: true });
    const result = resolveGlobPatterns(root, ["packages/*"]);
    expect(result).toHaveLength(1);
  });

  test("handles literal (non-glob) paths", () => {
    write("libs/ui/package.json", JSON.stringify({ name: "@org/ui" }));
    const result = resolveGlobPatterns(root, ["libs/ui"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("@org/ui");
  });

  test("returns empty array when the glob base directory does not exist", () => {
    const result = resolveGlobPatterns(root, ["nonexistent/*"]);
    expect(result).toHaveLength(0);
  });

  test("deduplicates packages across multiple patterns", () => {
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    const result = resolveGlobPatterns(root, ["packages/*", "packages/*"]);
    expect(result).toHaveLength(1);
  });

  test("resolves ** (recursive) glob", () => {
    write("deep/nested/pkg/package.json", JSON.stringify({ name: "@org/nested" }));
    const result = resolveGlobPatterns(root, ["deep/**"]);
    expect(result.some((p) => p.name === "@org/nested")).toBe(true);
  });
});
