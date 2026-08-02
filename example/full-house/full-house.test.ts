import path from "node:path";
import { describe, expect, test } from "vitest";
import { createImportMap } from "../../src/index";

/**
 * Regression test for two style-parsing/resolution bugs fixed together:
 *  1. `postcss-less` interop in src/parser/style/css.ts (a broken fix would throw
 *     while parsing theme.less/variables.less below).
 *  2. Bare style specifiers (`@import "colors"`, `@import "grid.styl"`,
 *     `@import "variables.less"`) resolving as external packages instead of
 *     sibling files — this fixture's main.scss/layout.styl/theme.less already use
 *     that bare-specifier convention, including the Sass `_partial` naming rule.
 */
describe("full-house example: style import resolution", { tags: ["example", "style"] }, () => {
  const rootDir = __dirname;

  test("resolves bare Stylus @import to a sibling file", async () => {
    const graph = await createImportMap(rootDir, ["layout.styl"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("layout.styl");

    expect(node?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "grid.styl",
        toPath: "grid.styl",
        isExternal: false,
      }),
    );
    expect(node?.tags).not.toContainEqual(expect.objectContaining({ kind: "library" }));
  });

  test("resolves bare Sass @import via the _partial naming convention", async () => {
    const graph = await createImportMap(rootDir, ["main.scss"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("main.scss");

    expect(node?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "colors",
        toPath: "_colors.scss",
        isExternal: false,
      }),
    );
    expect(node?.tags).not.toContainEqual(expect.objectContaining({ kind: "library" }));
  });

  test("resolves bare Less @import to a sibling file without throwing", async () => {
    const graph = await createImportMap(rootDir, ["theme.less"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("theme.less");

    expect(node?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "variables.less",
        toPath: "variables.less",
        isExternal: false,
      }),
    );
    expect(node?.tags).not.toContainEqual(expect.objectContaining({ kind: "library" }));
  });

  test("leaves an explicit ./ CSS @import untouched", async () => {
    const graph = await createImportMap(rootDir, ["styles.css"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("styles.css");

    expect(node?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "./reset.css",
        toPath: "reset.css",
        isExternal: false,
      }),
    );
  });

  test("still tags genuinely external imports as libraries", async () => {
    const graph = await createImportMap(rootDir, ["main.py"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get(path.relative(rootDir, path.join(rootDir, "main.py")));

    expect(node?.imports).toContainEqual(expect.objectContaining({ rawSpecifier: "os", isExternal: true }));
    expect(node?.tags).toContainEqual({ name: "os", kind: "library" });
  });
});

/**
 * End-to-end coverage (parse → resolve → graph) for Lua/CoffeeScript export extraction,
 * complementing the parser-level unit tests in src/parser/lang/lua.test.ts and coffee.test.ts.
 */
describe("full-house example: Lua/CoffeeScript exports", { tags: ["example", "exports"] }, () => {
  const rootDir = __dirname;

  test("Lua: local M = {} module-table exports resolve through the graph", async () => {
    const graph = await createImportMap(rootDir, ["config.lua"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("config.lua");

    expect(node?.exports).toEqual(expect.arrayContaining([{ name: "load" }, { name: "path" }]));
    expect(node?.imports).toContainEqual(expect.objectContaining({ toPath: "settings.lua" }));
  });

  test("Lua: return { ... } table literal exports resolve through the graph", async () => {
    const graph = await createImportMap(rootDir, ["settings.lua"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("settings.lua");

    expect(node?.exports).toEqual([{ name: "debug" }]);
  });

  test("CoffeeScript: module.exports = { shorthand } exports resolve through the graph", async () => {
    const graph = await createImportMap(rootDir, ["script.coffee"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("script.coffee");

    expect(node?.exports).toEqual([{ name: "foo" }]);
  });

  test("CoffeeScript: require specifier is unquoted, so it resolves to the sibling file", async () => {
    const graph = await createImportMap(rootDir, ["script.coffee"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("script.coffee");

    expect(node?.imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "./math.js", toPath: "math.js", isExternal: false }),
    );
    expect(node?.tags).not.toContainEqual(expect.objectContaining({ kind: "library" }));
  });
});

/**
 * End-to-end coverage (parse → resolve → graph) for LiveScript export extraction,
 * complementing the parser-level unit tests in src/parser/lang/ls.test.ts.
 */
describe("full-house example: LiveScript exports", { tags: ["example", "exports"] }, () => {
  const rootDir = __dirname;

  test("LiveScript: export foo = ... resolves through the graph", async () => {
    const graph = await createImportMap(rootDir, ["app.ls"], null, {
      silent: true,
      parallelParsing: false,
    });
    const node = graph.nodes.get("app.ls");

    expect(node?.exports).toEqual([{ name: "greet" }]);
    expect(node?.imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "./math.js", toPath: "math.js", isExternal: false }),
    );
  });
});

/**
 * End-to-end coverage (parse → resolve → graph) for Go/Python complexity scoring and
 * cross-file call edges, complementing the parser-level unit tests in
 * src/parser/lang/go.complexity.test.ts, go.call-edges.test.ts, python.complexity.test.ts,
 * and python.call-edges.test.ts.
 */
describe(
  "full-house example: Go/Python complexity and call edges",
  { tags: ["example", "complexity", "callEdges"] },
  () => {
    const rootDir = __dirname;

    test("Python: main() calling helper() produces a resolved call edge", async () => {
      const graph = await createImportMap(rootDir, ["main.py"], null, {
        silent: true,
        parallelParsing: false,
      });
      const mainNode = graph.nodes.get("main.py");
      const utilsNode = graph.nodes.get("utils.py");

      expect(mainNode?.callEdges).toEqual([{ from: "main", to: "helper", toFile: "utils.py" }]);
      expect(utilsNode?.complexity).toBe(2);
      expect(utilsNode?.cognitiveComplexity).toBe(1);
    });

    test("Go: Greet() calling greet.Hello() across packages produces a resolved call edge", async () => {
      const graph = await createImportMap(rootDir, ["service.go"], null, {
        silent: true,
        parallelParsing: false,
      });
      const serviceNode = graph.nodes.get("service.go");
      const greetNode = graph.nodes.get("greet/greet.go");

      expect(serviceNode?.callEdges).toEqual([
        { from: "Greet", to: "Hello", toFile: "greet/greet.go" },
      ]);
      expect(greetNode?.complexity).toBe(2);
      expect(greetNode?.cognitiveComplexity).toBe(1);
    });

    test("Go: receiver method (MethodDecl) is captured as an exported symbol", async () => {
      const graph = await createImportMap(rootDir, ["service.go"], null, {
        silent: true,
        parallelParsing: false,
      });
      const greetNode = graph.nodes.get("greet/greet.go");

      expect(greetNode?.exports).toContainEqual({ name: "Format" });
    });
  },
);