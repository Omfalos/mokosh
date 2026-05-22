import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { DefaultResolver } from "./resolver";

// ─── helpers ─────────────────────────────────────────────────────────────────

function setup(files: Record<string, string>): { root: string; resolver: DefaultResolver } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-resolver-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return { root, resolver: new DefaultResolver(root) };
}

// ─── TypeScript / JavaScript (existing behaviour unchanged) ──────────────────

describe("TS/JS resolution", () => {
  let root: string;
  let resolver: DefaultResolver;

  beforeAll(() => {
    ({ root, resolver } = setup({
      "src/utils.ts": "",
      "src/index.ts": "",
    }));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("relative ./ specifier resolves to .ts file", () => {
    const result = resolver.resolve(path.join(root, "src/app.ts"), "./utils");
    expect(result).toMatchObject({ path: path.join(root, "src/utils.ts"), isExternal: false });
  });

  test("bare package name → external", () => {
    const result = resolver.resolve(path.join(root, "src/app.ts"), "lodash");
    expect(result).toMatchObject({ isExternal: true });
  });
});

// ─── Python relative imports ──────────────────────────────────────────────────

describe("Python relative imports", () => {
  let root: string;
  let resolver: DefaultResolver;

  beforeAll(() => {
    ({ root, resolver } = setup({
      "mypackage/__init__.py": "",
      "mypackage/models.py": "",
      "mypackage/utils.py": "",
      "mypackage/sub/views.py": "",
      "mypackage/sub/__init__.py": "",
    }));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("./models → resolves to models.py in same directory", () => {
    const caller = path.join(root, "mypackage/views.py");
    const result = resolver.resolve(caller, "./models");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/models.py"),
      isExternal: false,
    });
  });

  test("./utils → resolves to utils.py in same directory", () => {
    const caller = path.join(root, "mypackage/views.py");
    const result = resolver.resolve(caller, "./utils");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/utils.py"),
      isExternal: false,
    });
  });

  test("../models → resolves to models.py one level up", () => {
    const caller = path.join(root, "mypackage/sub/views.py");
    const result = resolver.resolve(caller, "../models");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/models.py"),
      isExternal: false,
    });
  });

  test("./ with __init__.py → resolves to package init", () => {
    const caller = path.join(root, "mypackage/views.py");
    // Resolving the package directory itself (from . import sub) → sub/__init__.py
    const result = resolver.resolve(caller, "./sub");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/sub/__init__.py"),
      isExternal: false,
    });
  });
});

// ─── Python bare module names ─────────────────────────────────────────────────

describe("Python bare module imports", () => {
  let root: string;
  let resolver: DefaultResolver;

  beforeAll(() => {
    ({ root, resolver } = setup({
      "mymodule.py": "",
      "mypackage/__init__.py": "",
      "mypackage/models.py": "",
    }));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  test("bare name matching a local .py file → internal", () => {
    const result = resolver.resolve(path.join(root, "main.py"), "mymodule");
    expect(result).toMatchObject({ path: path.join(root, "mymodule.py"), isExternal: false });
  });

  test("bare name matching a local package → resolves to __init__.py", () => {
    const result = resolver.resolve(path.join(root, "main.py"), "mypackage");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/__init__.py"),
      isExternal: false,
    });
  });

  test("dotted bare name → converts dots to path separators", () => {
    const result = resolver.resolve(path.join(root, "main.py"), "mypackage.models");
    expect(result).toMatchObject({
      path: path.join(root, "mypackage/models.py"),
      isExternal: false,
    });
  });

  test("stdlib / third-party name with no local file → external", () => {
    const result = resolver.resolve(path.join(root, "main.py"), "os");
    expect(result).toMatchObject({ isExternal: true });
  });

  test("third-party package not on disk → external", () => {
    const result = resolver.resolve(path.join(root, "main.py"), "numpy");
    expect(result).toMatchObject({ isExternal: true });
  });

  test("non-Python file with same bare name → still external (no Python logic)", () => {
    const result = resolver.resolve(path.join(root, "main.ts"), "mymodule");
    expect(result).toMatchObject({ isExternal: true });
  });
});

// ─── Workspace package resolution ────────────────────────────────────────────

describe("workspace package resolution", () => {
  let root: string;
  let sharedRoot: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-ws-resolver-"));
    sharedRoot = path.join(root, "packages/shared");
    fs.mkdirSync(path.join(sharedRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(sharedRoot, "src/index.ts"), "");
    fs.writeFileSync(path.join(sharedRoot, "src/utils.ts"), "");
    fs.mkdirSync(path.join(root, "packages/app/src"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/app/src/page.ts"), "");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  function makeResolver() {
    const workspaceMap = new Map([["@org/shared", sharedRoot]]);
    return new DefaultResolver(root, { workspaceMap });
  }

  test("exact package name resolves to src/index.ts", () => {
    const result = makeResolver().resolve(
      path.join(root, "packages/app/src/page.ts"),
      "@org/shared",
    );
    expect(result).toMatchObject({
      path: path.join(sharedRoot, "src/index.ts"),
      isExternal: false,
      isWorkspace: true,
      workspacePackage: "@org/shared",
    });
  });

  test("deep import resolves within the workspace package", () => {
    const result = makeResolver().resolve(
      path.join(root, "packages/app/src/page.ts"),
      "@org/shared/src/utils",
    );
    expect(result).toMatchObject({
      path: path.join(sharedRoot, "src/utils.ts"),
      isExternal: false,
      isWorkspace: true,
      workspacePackage: "@org/shared",
    });
  });

  test("unknown scoped package falls through to external", () => {
    const result = makeResolver().resolve(
      path.join(root, "packages/app/src/page.ts"),
      "@other/pkg",
    );
    expect(result).toMatchObject({ isExternal: true });
    expect(result?.isWorkspace).toBeUndefined();
  });

  test("regular relative imports are unaffected by workspace map", () => {
    const result = makeResolver().resolve(path.join(root, "packages/app/src/page.ts"), "./sibling");
    // no sibling file exists, should return null
    expect(result).toBeNull();
  });

  test("workspace resolution is skipped when no workspace map provided", () => {
    const resolver = new DefaultResolver(root);
    const result = resolver.resolve(path.join(root, "packages/app/src/page.ts"), "@org/shared");
    expect(result).toMatchObject({ isExternal: true });
    expect(result?.isWorkspace).toBeUndefined();
  });
});
