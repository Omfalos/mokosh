import { describe, expect, test } from "vitest";
import { parseLua } from "./lua";

// ─── require() imports ─────────────────────────────────────────────────────

describe("require() imports", { tags: ["parseLua", "lua"] }, () => {
  test("call-style require → static edge", () => {
    const { imports } = parseLua("a.lua", `local foo = require("foo")`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "foo", type: "require" });
  });

  test("string-call-style require (no parens) → static edge", () => {
    const { imports } = parseLua("a.lua", `local foo = require "foo"`);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({ rawSpecifier: "foo", type: "require" });
  });
});

// ─── module exports ────────────────────────────────────────────────────────

describe("module exports", { tags: ["parseLua", "lua"] }, () => {
  test("local M = {} table with M.field function/assignment members", () => {
    const { exports } = parseLua(
      "a.lua",
      `
local M = {}
function M.foo(x) return x end
M.bar = function() end
local function priv() end
return M
`,
    );
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
  });

  test("global (non-local) top-level function declaration is exported", () => {
    const { exports } = parseLua("a.lua", `function globalFn() end`);
    expect(exports).toEqual([{ name: "globalFn" }]);
  });

  test("local top-level function declaration is not exported", () => {
    const { exports } = parseLua("a.lua", `local function priv() end`);
    expect(exports).toEqual([]);
  });

  test("return { ... } table literal → one export per field", () => {
    const { exports } = parseLua(
      "a.lua",
      `
local function helper() end
return {
  foo = helper,
  bar = function() end,
}
`,
    );
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar"]);
  });

  test("module table field and return-table field are deduplicated", () => {
    const { exports } = parseLua(
      "a.lua",
      `
local M = {}
function M.foo() end
return M
`,
    );
    expect(exports).toEqual([{ name: "foo" }]);
  });

  test("no exports when file has no module-table or return-table pattern", () => {
    const { exports } = parseLua("a.lua", `local x = 1`);
    expect(exports).toEqual([]);
  });
});

// ─── tags and category ─────────────────────────────────────────────────────

describe("tags and category", { tags: ["parseLua", "lua"] }, () => {
  test("@tag annotation is extracted as comment-marker tag", () => {
    const { tags } = parseLua("a.lua", `-- @tag auth\nlocal x = 1`);
    expect(tags).toContainEqual({ name: "auth", kind: "comment-marker" });
  });

  test(".test. filename is classified as test category", () => {
    const { category } = parseLua("foo.test.lua", `local x = 1`);
    expect(category).toBe("test");
  });

  test("syntax error falls back to empty imports/exports", () => {
    const result = parseLua("a.lua", `this is not ) valid lua (((`);
    expect(result.imports).toEqual([]);
    expect(result.exports).toEqual([]);
  });
});
