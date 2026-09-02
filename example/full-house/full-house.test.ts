import path from "node:path";
import { describe, expect, test } from "vitest";
import { createImportMap } from "../../src/";

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

/**
 * End-to-end coverage (parse → resolve → graph) for the JVM languages (Java via @lezer/java,
 * Kotlin/Scala/Groovy via hand-rolled scanners) and the shared JvmLangResolver, complementing
 * the unit tests in src/parser/lang/{java,kotlin,scala,groovy}.test.ts and
 * src/graph/lang-resolvers/jvm.test.ts.
 *
 * Fixture layout is a two-module Gradle-style tree under jvm/:
 *   jvm/settings.gradle, jvm/app/build.gradle          → Groovy build scripts (category: config)
 *   jvm/app/src/main/{java,kotlin,scala,groovy}/...     → app module sources
 *   jvm/core/src/main/java/com/example/core/CoreUtil.java → separate module imported by :app
 */
describe("full-house example: JVM languages", { tags: ["example", "jvm"] }, () => {
  const rootDir = path.join(__dirname, "jvm");
  const entryPoints = [
    "app/src/main/java/com/example/app/App.java",
    "app/src/main/kotlin/com/example/app/Ui.kt",
    "app/src/main/scala/com/example/app/Report.scala",
    "app/src/main/groovy/com/example/app/Formatter.groovy",
    "settings.gradle",
    "app/build.gradle",
  ];
  const build = () =>
    createImportMap(rootDir, entryPoints, null, { silent: true, parallelParsing: false });

  test("Java: FQN import resolves across Gradle modules to a concrete file", async () => {
    const graph = await build();
    const app = graph.nodes.get("app/src/main/java/com/example/app/App.java");

    expect(app?.type).toBe("java");
    expect(app?.category).toBe("logic");
    expect(app?.exports).toEqual([{ name: "App" }]);
    expect(app?.tags).toContainEqual({ name: "app", kind: "comment-marker" });
    expect(app?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "com.example.core.CoreUtil",
        toPath: "core/src/main/java/com/example/core/CoreUtil.java",
        isExternal: false,
      }),
    );
  });

  test("Kotlin: multiple top-level types in one file are all exported (name != file name)", async () => {
    const graph = await build();
    const repos = graph.nodes.get("app/src/main/kotlin/com/example/data/Repositories.kt");

    expect(repos?.type).toBe("kotlin");
    expect(repos?.exports).toEqual([{ name: "UserRepo" }, { name: "Session" }]);
    // `import com.example.core.CoreUtil as Core` — alias dropped, cross-language edge to Java.
    expect(repos?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "com.example.core.CoreUtil",
        toPath: "core/src/main/java/com/example/core/CoreUtil.java",
        isExternal: false,
      }),
    );
  });

  test("Kotlin: a type declared in a differently-named file resolves via package expansion", async () => {
    const graph = await build();
    const ui = graph.nodes.get("app/src/main/kotlin/com/example/app/Ui.kt");

    expect(ui?.tags).toContainEqual({ name: "ui", kind: "comment-marker" });
    // `UserRepo` lives in Repositories.kt; the resolver falls back to the package directory.
    expect(ui?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "com.example.data.UserRepo",
        toPath: "app/src/main/kotlin/com/example/data/Repositories.kt",
        isExternal: false,
      }),
    );
  });

  test("Scala: brace-group and block-scoped imports are both captured", async () => {
    const graph = await build();
    const report = graph.nodes.get("app/src/main/scala/com/example/app/Report.scala");

    expect(report?.type).toBe("scala");
    expect(report?.exports).toEqual([{ name: "Report" }]);
    // `import com.example.data.{ User, UserRepo }` → one edge per member.
    expect(report?.imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "com.example.data.User", isExternal: false }),
    );
    expect(report?.imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "com.example.data.UserRepo", isExternal: false }),
    );
    // Block-scoped `import scala.collection.mutable.ListBuffer` inside a def — still scanned.
    expect(report?.imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "scala.collection.mutable.ListBuffer" }),
    );
  });

  test("Groovy: `import static` resolves to the enclosing type's file", async () => {
    const graph = await build();
    const formatter = graph.nodes.get("app/src/main/groovy/com/example/app/Formatter.groovy");

    expect(formatter?.type).toBe("groovy");
    expect(formatter?.exports).toEqual([{ name: "Formatter" }]);
    expect(formatter?.imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "com.example.core.CoreUtil",
        toPath: "core/src/main/java/com/example/core/CoreUtil.java",
        isExternal: false,
      }),
    );
  });

  test("same-package siblings are linked even with no explicit import (synthetic edge)", async () => {
    const graph = await build();
    const app = graph.nodes.get("app/src/main/java/com/example/app/App.java");

    // App.java, Ui.kt, Report.scala, Formatter.groovy all declare `package com.example.app`
    // and reference each other with no `import` line — JVM allows that. The synthetic
    // `com.example.app.*` edge makes the coupling visible to blast-radius analysis.
    const siblingTargets = (app?.imports ?? [])
      .filter((e) => e.rawSpecifier === "com.example.app.*")
      .map((e) => e.toPath);
    expect(siblingTargets).toEqual(
      expect.arrayContaining([
        "app/src/main/kotlin/com/example/app/Ui.kt",
        "app/src/main/scala/com/example/app/Report.scala",
        "app/src/main/groovy/com/example/app/Formatter.groovy",
      ]),
    );
    // never itself
    expect(siblingTargets).not.toContain("app/src/main/java/com/example/app/App.java");
  });

  test("Gradle build scripts are parsed as Groovy and categorised as config", async () => {
    const graph = await build();

    expect(graph.nodes.get("settings.gradle")).toMatchObject({ type: "groovy", category: "config" });
    expect(graph.nodes.get("app/build.gradle")).toMatchObject({
      type: "groovy",
      category: "config",
    });
  });
});