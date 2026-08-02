import { describe, expect, test } from "vitest";
import { parseLiveScript } from "./ls";

// ─── imports ────────────────────────────────────────────────────────────────

describe("imports", { tags: ["parseLiveScript", "ls"] }, () => {
  test("import 'module' declaration → static edge", () => {
    const { imports } = parseLiveScript("a.ls", `import 'some-module'`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "some-module", type: "static" });
  });

  test("require() call → require edge", () => {
    const { imports } = parseLiveScript("a.ls", `foo = require 'foo'`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "foo", type: "require" });
  });
});

// ─── module exports ─────────────────────────────────────────────────────────

describe("module exports", { tags: ["parseLiveScript", "ls"] }, () => {
  test("module.exports = {a, b} shorthand object → named exports", () => {
    const { exports } = parseLiveScript("a.ls", `module.exports = {foo, bar}`);
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
  });

  test("module.exports = class Foo → class name export", () => {
    const { exports } = parseLiveScript("a.ls", `module.exports = class Widget`);
    expect(exports).toEqual([{ name: "Widget" }]);
  });

  test("exports.baz = value → single named export", () => {
    const { exports } = parseLiveScript("a.ls", `exports.baz = 42`);
    expect(exports).toEqual([{ name: "baz" }]);
  });

  test("export class Foo → class name export", () => {
    const { exports } = parseLiveScript("a.ls", `export class Widget\n  method: ->`);
    expect(exports).toEqual([{ name: "Widget" }]);
  });

  test("export foo = ... → named export", () => {
    const { exports } = parseLiveScript("a.ls", `export foo2 = ->\n  1`);
    expect(exports).toEqual([{ name: "foo2" }]);
  });

  test("export {a, b} → named exports", () => {
    const { exports } = parseLiveScript("a.ls", `export {a, b}`);
    expect(exports.map((e) => e.name)).toEqual(["a", "b"]);
  });

  test("no exports when file has no module-exports pattern", () => {
    const { exports } = parseLiveScript("a.ls", `x = 1`);
    expect(exports).toEqual([]);
  });
});

// ─── tags and category ──────────────────────────────────────────────────────

describe("tags and category", { tags: ["parseLiveScript", "ls"] }, () => {
  test("@tag annotation is extracted as comment-marker tag", () => {
    const { tags } = parseLiveScript("a.ls", `# @tag auth\nx = 1`);
    expect(tags).toContainEqual({ name: "auth", kind: "comment-marker" });
  });

  test(".test. filename is classified as test category", () => {
    const { category } = parseLiveScript("foo.test.ls", `x = 1`);
    expect(category).toBe("test");
  });

  test("syntax error falls back to empty imports/exports", () => {
    const result = parseLiveScript("a.ls", `this is not ) valid ls (((`);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
  });
});
