import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { DefaultResolver } from "../resolver";
import { GoLangResolver } from "./go";
import { LuaLangResolver } from "./lua";
import { MarkdownLangResolver } from "./markdown";
import { PythonLangResolver } from "./python";
import { StyleLangResolver } from "./style";
import type { LangResolver } from "./types";

// ─── helpers ──────────────────────────────────────────────────────────────────

const noop = () => null;

function setup(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-resolver-robust-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// ─── every resolver degrades to null on an unresolvable specifier ──────────────

describe("LangResolver — unresolvable specifier degrades to null, never throws", {
  tags: ["resolver", "robustness"],
}, () => {
  let root: string;
  beforeAll(() => {
    root = setup({
      "go.mod": "module example.com/app\n\ngo 1.21\n",
      "src/app.py": "",
      "src/app.lua": "",
      "docs/guide.md": "",
      "styles/app.scss": "",
    });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  const cases: Array<[string, LangResolver, string, string]> = [
    ["python", new PythonLangResolver(), path.join("src", "app.py"), "totally.missing.module"],
    ["lua", new LuaLangResolver(), path.join("src", "app.lua"), "missing.module"],
    ["go", new GoLangResolver(), path.join("src", "main.go"), "github.com/other/unrelated/pkg"],
    [
      "markdown",
      new MarkdownLangResolver(),
      path.join("docs", "guide.md"),
      "src/does/not/exist.ts",
    ],
    ["style", new StyleLangResolver(), path.join("styles", "app.scss"), "nonexistent-partial"],
  ];

  for (const [name, resolver, currentRel, specifier] of cases) {
    test(`${name}: returns null and does not throw`, () => {
      const currentFile = path.join(root, currentRel);
      const resolveLocal = () => null;
      let result: unknown;
      expect(() => {
        result = resolver.resolve(currentFile, specifier, root, resolveLocal);
      }).not.toThrow();
      expect(result).toBeNull();
    });
  }
});

// ─── a throwing LangResolver must not abort DefaultResolver ────────────────────

describe("DefaultResolver — a LangResolver that throws is isolated", {
  tags: ["resolver", "robustness"],
}, () => {
  let root: string;
  beforeAll(() => {
    root = setup({ "src/app.py": "import something\n" });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  class ExplodingResolver implements LangResolver {
    extensions = [".py"];
    resolve(): never {
      throw new Error("boom");
    }
  }

  test("falls through to external instead of propagating the throw, warns once", () => {
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const resolver = new DefaultResolver(root, { langResolvers: [new ExplodingResolver()] });

    let result: unknown;
    expect(() => {
      result = resolver.resolve(path.join(root, "src/app.py"), "something");
    }).not.toThrow();
    // Unresolved by the (exploding) lang resolver → treated as external, not a phantom node.
    expect(result).toEqual({ path: "something", isExternal: true });

    // A second trip through the same broken resolver stays silent.
    resolver.resolve(path.join(root, "src/app.py"), "another");
    const boomWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("ExplodingResolver"));
    expect(boomWarnings).toHaveLength(1);

    warn.mockRestore();
  });
});

// ─── local package must not shadow a same-named external dependency ────────────

describe("local-vs-external shadowing guardrails", { tags: ["resolver", "robustness"] }, () => {
  test("go: an external module sharing the module-name prefix is not resolved local", () => {
    const root = setup({
      "go.mod": "module github.com/myorg/app\n\ngo 1.21\n",
      "internal/utils/utils.go": "",
    });
    const resolver = new GoLangResolver();
    // `github.com/myorg/app-helpers` shares the `github.com/myorg/app` prefix but is a
    // different module — the trailing-slash check must keep it external.
    expect(resolver.resolve("", "github.com/myorg/app-helpers/x", root, noop)).toBeNull();
    // Sanity: the genuinely module-local path still resolves.
    expect(resolver.resolve("", "github.com/myorg/app/internal/utils", root, noop)).not.toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("python: a bare stdlib-style name with no matching local file stays external", () => {
    const root = setup({ "src/app.py": "" });
    const resolver = new PythonLangResolver();
    // No `json.py` / `json/__init__.py` on disk → null (falls through to external). A project
    // that *does* ship `json/__init__.py` genuinely shadows the stdlib at import time, so
    // resolving that one locally is correct Python semantics.
    expect(resolver.resolve(path.join(root, "src/app.py"), "json", root, noop)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
