import { describe, expect, test } from "vitest";
import { parseCoffeeScript } from "./coffee";

// ─── imports ────────────────────────────────────────────────────────────────

describe("imports", { tags: ["parseCoffeeScript", "coffee"] }, () => {
  test("ES import declaration → static edge with unquoted specifier", () => {
    const { imports } = parseCoffeeScript("a.coffee", `import foo from 'foo'`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "foo", type: "static" });
  });

  test("require() call → require edge with unquoted specifier", () => {
    const { imports } = parseCoffeeScript("a.coffee", `foo = require 'foo'`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "foo", type: "require" });
  });

  test("double-quoted specifier is also unquoted", () => {
    const { imports } = parseCoffeeScript("a.coffee", `foo = require "./bar.js"`);
    expect(imports[0]).toMatchObject({ rawSpecifier: "./bar.js", type: "require" });
  });
});

// ─── module exports ────────────────────────────────────────────────────────

describe("module exports", { tags: ["parseCoffeeScript", "coffee"] }, () => {
  test("module.exports = { ... } object literal → one export per field", () => {
    const { exports } = parseCoffeeScript(
      "a.coffee",
      `
module.exports = {
  foo: -> 1
  bar: 2
}
`,
    );
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
  });

  test("module.exports = { shorthand } object literal → one export per shorthand property", () => {
    const { exports } = parseCoffeeScript(
      "a.coffee",
      `
foo = -> 1
bar = 2
module.exports = { foo, bar }
`,
    );
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
  });

  test("exports.<name> = ... → named export", () => {
    const { exports } = parseCoffeeScript("a.coffee", `exports.baz = 3`);
    expect(exports).toEqual([{ name: "baz" }]);
  });

  test("module.exports = class Foo → export named after the class", () => {
    const { exports } = parseCoffeeScript("a.coffee", `module.exports = class Widget`);
    expect(exports).toEqual([{ name: "Widget" }]);
  });

  test("module.exports = <identifier> → bare re-export by name", () => {
    const { exports } = parseCoffeeScript(
      "a.coffee",
      `
helper = -> 1
module.exports = helper
`,
    );
    expect(exports).toEqual([{ name: "helper" }]);
  });

  test("export default → export named 'default'", () => {
    const { exports } = parseCoffeeScript("a.coffee", `foo = -> 1\nexport default foo`);
    expect(exports).toContainEqual({ name: "default" });
  });

  test("export { name } specifier list → named export", () => {
    const { exports } = parseCoffeeScript("a.coffee", `bar = 1\nexport { bar }`);
    expect(exports).toContainEqual({ name: "bar" });
  });

  test("export foo = value → named export", () => {
    const { exports } = parseCoffeeScript("a.coffee", `export bar2 = 5`);
    expect(exports).toEqual([{ name: "bar2" }]);
  });

  test("plain top-level assignment (no module.exports/export) is not exported", () => {
    const { exports } = parseCoffeeScript("a.coffee", `foo = -> 1`);
    expect(exports).toEqual([]);
  });
});

// ─── tags and category ─────────────────────────────────────────────────────

describe("tags and category", { tags: ["parseCoffeeScript", "coffee"] }, () => {
  test("@tag annotation is extracted as comment-marker tag", () => {
    const { tags } = parseCoffeeScript("a.coffee", `# @tag auth\nfoo = 1`);
    expect(tags).toContainEqual({ name: "auth", kind: "comment-marker" });
  });

  test(".spec. filename is classified as test category", () => {
    const { category } = parseCoffeeScript("foo.spec.coffee", `foo = 1`);
    expect(category).toBe("test");
  });

  test("syntax error falls back to empty imports/exports", () => {
    const result = parseCoffeeScript("a.coffee", `class extends`);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
  });
});
