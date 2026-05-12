import { describe, expect, test } from "vitest";
import { parseFile, parseImports } from "./parser";

describe("parseImports", () => {
  test("parseImports - static imports", async () => {
    const content = `
      import { a } from './a';
      import b from '../b';
      import * as c from 'c';
    `;
    const imports = await parseImports("test.ts", content);

    expect(imports.length).toBe(3);
    expect(imports[0]?.rawSpecifier).toBe("./a");
    expect(imports[1]?.rawSpecifier).toBe("../b");
    expect(imports[2]?.rawSpecifier).toBe("c");
  });

  test("parseImports - re-exports", async () => {
    const content = `
      export { x } from './x';
      export * from './y';
    `;
    const imports = await parseImports("test.ts", content);

    expect(imports.length).toBe(2);
    expect(imports[0]?.rawSpecifier).toBe("./x");
    expect(imports[1]?.rawSpecifier).toBe("./y");
  });

  test("parseImports - dynamic imports", async () => {
    const content = `
      const module = await import('./dynamic');
      import('./other').then(() => {});
    `;
    const imports = await parseImports("test.ts", content);

    expect(imports.length).toBe(2);
    expect(imports[0]?.rawSpecifier).toBe("./dynamic");
    expect(imports[1]?.rawSpecifier).toBe("./other");
  });

  test("parseImports - require calls", async () => {
    const content = `
      const a = require('./a');
      require('node:fs');
    `;
    const imports = await parseImports("test.ts", content);

    expect(imports.length).toBe(2);
    expect(imports[0]?.rawSpecifier).toBe("./a");
    expect(imports[1]?.rawSpecifier).toBe("node:fs");
  });

  test("parseImports - CSS @import", async () => {
    const content = `
      @import "./reset.css";
      @import 'variables.scss';
    `;
    const imports = await parseImports("test.css", content);

    expect(imports.length).toBe(2);
    expect(imports[0]?.rawSpecifier).toBe("./reset.css");
    expect(imports[1]?.rawSpecifier).toBe("variables.scss");
    expect(imports[0]?.isStyle).toBe(true);
  });

  test("parseImports - identifies style files in JS", async () => {
    const content = `
      import './styles.css';
      import './theme.scss';
      import './app.js';
    `;
    const imports = await parseImports("test.ts", content);

    expect(imports.length).toBe(3);
    expect(imports[0]?.isStyle).toBe(true);
    expect(imports[1]?.isStyle).toBe(true);
    expect(imports[2]?.isStyle).toBe(false);
  });

  test("parseStyleFile - ignores commented imports", async () => {
    const content = `
      @import "./real.css";
      /* @import "./commented.css"; */
      // @import "./line-comment.css";
    `;
    const imports = await parseImports("test.css", content);
    expect(imports.length).toBe(1);
    expect(imports[0]?.rawSpecifier).toBe("./real.css");
  });

  test("determineCategory - detects testing libraries", async () => {
    const content = `import { test, expect } from '@playwright/test';`;
    const result = await parseFile("login.ts", content);
    expect(result.category).toBe("test");
  });

  test("parseImports - Less and Stylus @import", async () => {
    const content = `@import "./reset.less";
import "./theme.styl";
require("./other.styl");`;
    const importsLess = await parseImports("test.less", content);
    expect(importsLess.length).toBe(1);

    const importsStyl = await parseImports("test.styl", content);
    expect(importsStyl.length).toBe(2);
  });

  test("parseImports - CoffeeScript and LiveScript", async () => {
    const coffeeContent = `import { a } from './a'
require('./b')
require("./c")`;
    const importsCoffee = await parseImports("test.coffee", coffeeContent);
    expect(importsCoffee.length).toBe(3);

    const lsContent = `import './a'
require './b'`;
    const importsLs = await parseImports("test.ls", lsContent);
    expect(importsLs.length).toBe(2);
  });

  test("parseImports - Lua", async () => {
    const content = `
      local a = require('module_a')
      require "module_b"
      local x = 1
    `;
    const imports = await parseImports("test.lua", content);
    expect(imports.length).toBe(2);
    expect(imports[0]?.rawSpecifier).toBe("module_a");
    expect(imports[1]?.rawSpecifier).toBe("module_b");
  });

  test("parseImports - Lua edge cases", async () => {
    const content = `
      require('outer').require('inner') -- this is tricky, should probably only get 'outer' if it's a call on require result
      require 'space'
      require"no_space"
    `;
    const imports = await parseImports("test.lua", content);
    // My current impl handles require('outer') but what about .require?
    // luaparse will see .require as part of a MemberExpression if it's chained.
    // My traverse currently looks for CallExpression where base is Identifier 'require'.
    // require('outer').require('inner'):
    // CallExpression (require('inner')) -> base is MemberExpression (require('outer').require)
    // So it WON'T match the inner one. This is actually good/safe for now as it's not a standard require.
    expect(imports.length).toBe(3);
    expect(imports[0]?.rawSpecifier).toBe("outer");
    expect(imports[1]?.rawSpecifier).toBe("space");
    expect(imports[2]?.rawSpecifier).toBe("no_space");
  });

  test("tag and category extraction for Coffee, LS, Lua", async () => {
    const coffeeContent = "# @tag coffee-test\nimport { a } from './a'";
    const coffeeResult = await parseFile("test.coffee", coffeeContent);
    expect(coffeeResult.tags.map((t) => t.name)).toContain("coffee-test");
    expect(coffeeResult.category).toBe("logic");

    const coffeeTestContent = "# @tag test\nimport './a'";
    const coffeeTestResult = await parseFile("test.coffee", coffeeTestContent);
    expect(coffeeTestResult.category).toBe("test");

    const luaTestContent = "-- @tag performance\nrequire 'mod'";
    const luaResult = await parseFile("test.lua", luaTestContent);
    expect(luaResult.tags.map((t) => t.name)).toContain("performance");
    expect(luaResult.category).toBe("logic");

    const luaSpecContent = "-- unit test\nrequire 'mod'";
    const luaSpecResult = await parseFile("test.spec.lua", luaSpecContent);
    expect(luaSpecResult.category).toBe("test");

    const lsContent = "# @tag ls-meta\nimport './a'";
    const lsResult = await parseFile("test.ls", lsContent);
    expect(lsResult.tags.map((t) => t.name)).toContain("ls-meta");
  });

  test("Gherkin (.feature) parsing", async () => {
    const content = `
      @smoke @ui
      Feature: User Login
        @auth
        Scenario: Successful login
          Given the login page is open

        @negative
        Scenario Outline: Failed login
          Given the login page is open
          @slow
          Examples:
            | username |
            | user1    |
    `;
    const result = await parseFile("login.feature", content);
    expect(result.category).toBe("test");
    expect(result.tags.map((t) => t.name)).toContain("smoke");
    expect(result.tags.map((t) => t.name)).toContain("ui");
    expect(result.tags.map((t) => t.name)).toContain("auth");
    expect(result.tags.map((t) => t.name)).toContain("negative");
    expect(result.tags.map((t) => t.name)).toContain("slow");
    expect(result.imports.length).toBe(0);
  });
});
