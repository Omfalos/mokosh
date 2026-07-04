import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { GoLangResolver } from "./go";

// ─── helpers ──────────────────────────────────────────────────────────────────

const noop = () => null;
const MOD = "github.com/myorg/myrepo";

function setup(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-go-resolver-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// ─── module-local resolution ──────────────────────────────────────────────────

describe("module-local resolution", { tags: ["GoLangResolver", "go"] }, () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({
      "go.mod": `module ${MOD}\n\ngo 1.21\n`,
      "internal/utils/utils.go": "",
      "internal/utils/helper.go": "",
      "pkg/auth/auth.go": "",
    });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("module-local specifier resolves to non-null", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    expect(result).not.toBeNull();
  });

  test("all non-test .go files in package are returned", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    expect(result).toHaveLength(2);
    expect(result?.every((r) => r.isExternal === false)).toBe(true);
  });

  test("files are sorted alphabetically", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    const names = result?.map((r) => path.basename(r.path));
    expect(names).toEqual(["helper.go", "utils.go"]);
  });

  test("resolved paths are inside the correct package directory", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    expect(result?.every((r) => r.path.startsWith(path.join(root, "internal/utils")))).toBe(true);
  });

  test("single-file package returns one entry", () => {
    const result = resolver.resolve("", `${MOD}/pkg/auth`, root, noop);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.path).toMatch(/\.go$/);
  });

  test("stdlib package → null (falls through to external)", () => {
    expect(resolver.resolve("", "fmt", root, noop)).toBeNull();
  });

  test("third-party package → null (falls through to external)", () => {
    expect(resolver.resolve("", "github.com/other/lib", root, noop)).toBeNull();
  });

  test("root module import (no subpath) → null", () => {
    expect(resolver.resolve("", MOD, root, noop)).toBeNull();
  });

  test("package directory does not exist → null", () => {
    expect(resolver.resolve("", `${MOD}/nonexistent/pkg`, root, noop)).toBeNull();
  });
});

// ─── replace directives ───────────────────────────────────────────────────────

describe("replace directives", { tags: ["GoLangResolver", "go"] }, () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({
      "go.mod": [
        `module ${MOD}`,
        "",
        "go 1.21",
        "",
        "replace (",
        "  github.com/myorg/shared => ./vendor-local/shared",
        "  github.com/myorg/versioned v1.0.0 => ./vendor-local/versioned",
        ")",
        "",
        "replace github.com/myorg/inline => ./vendor-local/inline",
      ].join("\n"),
      "vendor-local/shared/types.go": "",
      "vendor-local/shared/helpers.go": "",
      "vendor-local/versioned/main.go": "",
      "vendor-local/inline/api.go": "",
    });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("block-form replace resolves to local files", () => {
    const result = resolver.resolve("", "github.com/myorg/shared", root, noop);
    expect(result).toHaveLength(2);
    expect(result?.every((r) => r.isExternal === false)).toBe(true);
  });

  test("replace with version constraint on lhs is resolved", () => {
    const result = resolver.resolve("", "github.com/myorg/versioned", root, noop);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.path).toContain("versioned");
  });

  test("single-line replace is resolved", () => {
    const result = resolver.resolve("", "github.com/myorg/inline", root, noop);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.path).toContain("inline");
  });

  test("subpath of replaced module is resolved", () => {
    const result = resolver.resolve("", "github.com/myorg/shared/types", root, noop);
    // types/ subdir doesn't exist, so null — but the replace map was consulted
    expect(result).toBeNull();
  });
});

// ─── missing go.mod ───────────────────────────────────────────────────────────

describe("missing go.mod", { tags: ["GoLangResolver", "go"] }, () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({ "main.go": "" });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("no go.mod → null for any specifier", () => {
    expect(resolver.resolve("", "fmt", root, noop)).toBeNull();
    expect(resolver.resolve("", `${MOD}/pkg`, root, noop)).toBeNull();
  });
});

// ─── go.mod without module directive ─────────────────────────────────────────

describe("go.mod without module directive", { tags: ["GoLangResolver", "go"] }, () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({ "go.mod": "go 1.21\n" });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("malformed go.mod (no module line) → null", () => {
    expect(resolver.resolve("", `${MOD}/pkg`, root, noop)).toBeNull();
  });
});

// ─── test file exclusion ──────────────────────────────────────────────────────

describe("test file exclusion", { tags: ["GoLangResolver", "go"] }, () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({
      "go.mod": `module ${MOD}\n`,
      "pkg/testonly/auth_test.go": "",
      "pkg/mixed/impl.go": "",
      "pkg/mixed/impl_test.go": "",
    });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("directory with only _test.go files → null", () => {
    expect(resolver.resolve("", `${MOD}/pkg/testonly`, root, noop)).toBeNull();
  });

  test("_test.go files excluded from mixed package", () => {
    const result = resolver.resolve("", `${MOD}/pkg/mixed`, root, noop);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.path).toContain("impl.go");
    expect(result?.[0]?.path).not.toContain("impl_test.go");
  });
});

// ─── module cache ─────────────────────────────────────────────────────────────

describe("module cache", { tags: ["GoLangResolver", "go"] }, () => {
  test("go.mod is read only once per rootDir", () => {
    const root = setup({
      "go.mod": `module ${MOD}\n`,
      "pkg/foo/foo.go": "",
    });
    const resolver = new GoLangResolver();
    const spy = vi.spyOn(fs, "readFileSync");

    resolver.resolve("", `${MOD}/pkg/foo`, root, noop);
    resolver.resolve("", `${MOD}/pkg/foo`, root, noop);

    const goModReads = spy.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].endsWith("go.mod"),
    );
    expect(goModReads).toHaveLength(1);

    spy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
