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

describe("module-local resolution", () => {
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

  test("module-local specifier resolves to a .go file", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    expect(result).not.toBeNull();
    expect(result?.isExternal).toBe(false);
  });

  test("resolved path is inside the correct package directory", () => {
    const result = resolver.resolve("", `${MOD}/internal/utils`, root, noop);
    expect(result?.path).toContain(path.join(root, "internal/utils"));
  });

  test("resolved path is a .go file", () => {
    const result = resolver.resolve("", `${MOD}/pkg/auth`, root, noop);
    expect(result?.path).toMatch(/\.go$/);
  });

  test("stdlib package → null (falls through to external)", () => {
    const result = resolver.resolve("", "fmt", root, noop);
    expect(result).toBeNull();
  });

  test("third-party package → null (falls through to external)", () => {
    const result = resolver.resolve("", "github.com/other/lib", root, noop);
    expect(result).toBeNull();
  });

  test("root module import (no subpath) → null", () => {
    const result = resolver.resolve("", MOD, root, noop);
    expect(result).toBeNull();
  });

  test("package directory does not exist → null", () => {
    const result = resolver.resolve("", `${MOD}/nonexistent/pkg`, root, noop);
    expect(result).toBeNull();
  });
});

// ─── missing go.mod ───────────────────────────────────────────────────────────

describe("missing go.mod", () => {
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

describe("go.mod without module directive", () => {
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

// ─── representative file selection ───────────────────────────────────────────

describe("representative file selection", () => {
  let root: string;
  let resolver: GoLangResolver;

  beforeAll(() => {
    root = setup({
      "go.mod": `module ${MOD}\n`,
      "pkg/multi/alpha.go": "",
      "pkg/multi/beta.go": "",
      "pkg/withdoc/doc.go": "",
      "pkg/withdoc/impl.go": "",
      "pkg/testonly/auth_test.go": "",
    });
    resolver = new GoLangResolver();
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("multiple files → picks first alphabetically", () => {
    const result = resolver.resolve("", `${MOD}/pkg/multi`, root, noop);
    expect(result?.path).toContain("alpha.go");
  });

  test("doc.go present → preferred over alphabetical first", () => {
    const result = resolver.resolve("", `${MOD}/pkg/withdoc`, root, noop);
    expect(result?.path).toContain("doc.go");
  });

  test("only _test.go files in dir → null", () => {
    const result = resolver.resolve("", `${MOD}/pkg/testonly`, root, noop);
    expect(result).toBeNull();
  });
});

// ─── module cache ─────────────────────────────────────────────────────────────

describe("module cache", () => {
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
