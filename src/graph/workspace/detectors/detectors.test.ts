import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { gradleDetector } from "./gradle";
import { npmDetector } from "./npm";
import { nxDetector } from "./nx";
import { pnpmDetector } from "./pnpm";
import { sbtDetector } from "./sbt";
import { turborepoDetector } from "./turborepo";
import { yarnDetector } from "./yarn";

let root: string;

function write(rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-det-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── pnpm ─────────────────────────────────────────────────────────────────────

describe("pnpmDetector", {
  tags: [
    "npm",
    "npmDetector",
    "nx",
    "nxDetector",
    "pnpm",
    "pnpmDetector",
    "turborepo",
    "turborepoDetector",
    "yarn",
    "yarnDetector",
  ],
}, () => {
  test("returns null when pnpm-workspace.yaml is absent", () => {
    expect(pnpmDetector.detect(root)).toBeNull();
  });

  test("returns packages listed in pnpm-workspace.yaml", () => {
    write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    const pkgs = pnpmDetector.detect(root);
    expect(pkgs).not.toBeNull();
    expect(pkgs?.map((p) => p.name)).toContain("@org/a");
  });

  test("returns null when yaml is malformed", () => {
    write("pnpm-workspace.yaml", ": bad: yaml: {{{}}}");
    // js-yaml may throw — expect null (caught internally)
    const result = pnpmDetector.detect(root);
    // Either null or empty — not throwing
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  test("returns empty array when no patterns match existing dirs", () => {
    write("pnpm-workspace.yaml", "packages:\n  - nonexistent/*\n");
    const pkgs = pnpmDetector.detect(root);
    expect(pkgs).toEqual([]);
  });
});

// ─── npm ──────────────────────────────────────────────────────────────────────

describe("npmDetector", {
  tags: [
    "npm",
    "npmDetector",
    "nx",
    "nxDetector",
    "pnpm",
    "pnpmDetector",
    "turborepo",
    "turborepoDetector",
    "yarn",
    "yarnDetector",
  ],
}, () => {
  test("returns null when package.json is absent", () => {
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json has no workspaces field", () => {
    write("package.json", JSON.stringify({ name: "root" }));
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("returns null when yarn.lock is present (defers to yarn detector)", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    expect(npmDetector.detect(root)).toBeNull();
  });

  test("resolves packages from array workspaces field", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "@org/a" }));
    const pkgs = npmDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("@org/a");
  });

  test("resolves packages from object workspaces.packages field", () => {
    write("package.json", JSON.stringify({ name: "root", workspaces: { packages: ["apps/*"] } }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));
    const pkgs = npmDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("web");
  });
});

// ─── yarn ─────────────────────────────────────────────────────────────────────

describe("yarnDetector", {
  tags: [
    "npm",
    "npmDetector",
    "nx",
    "nxDetector",
    "pnpm",
    "pnpmDetector",
    "turborepo",
    "turborepoDetector",
    "yarn",
    "yarnDetector",
  ],
}, () => {
  test("returns null when yarn.lock is absent", () => {
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json is absent", () => {
    write("yarn.lock", "");
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("returns null when package.json has no workspaces field", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root" }));
    expect(yarnDetector.detect(root)).toBeNull();
  });

  test("resolves packages from yarn workspaces", () => {
    write("yarn.lock", "");
    write("package.json", JSON.stringify({ name: "root", workspaces: ["packages/*"] }));
    write("packages/a/package.json", JSON.stringify({ name: "pkg-a" }));
    const pkgs = yarnDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("pkg-a");
  });
});

// ─── nx ───────────────────────────────────────────────────────────────────────

describe("nxDetector", {
  tags: [
    "npm",
    "npmDetector",
    "nx",
    "nxDetector",
    "pnpm",
    "pnpmDetector",
    "turborepo",
    "turborepoDetector",
    "yarn",
    "yarnDetector",
  ],
}, () => {
  test("returns null when nx.json is absent", () => {
    expect(nxDetector.detect(root)).toBeNull();
  });

  test("discovers packages with project.json files", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web" }));
    write("apps/web/package.json", JSON.stringify({ name: "web" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("web");
  });

  test("discovers integrated-style projects (no package.json, name from project.json)", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("libs/ui/project.json", JSON.stringify({ name: "@org/ui" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toContain("@org/ui");
  });

  test("skips node_modules and dot directories", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("node_modules/some-pkg/project.json", JSON.stringify({ name: "should-skip" }));
    write(".nx/cache/project.json", JSON.stringify({ name: "also-skip" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).not.toContain("should-skip");
    expect(pkgs?.map((p) => p.name)).not.toContain("also-skip");
  });

  test("prefers package.json name over project.json name", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write("apps/web/project.json", JSON.stringify({ name: "web-proj" }));
    write("apps/web/package.json", JSON.stringify({ name: "@org/web" }));
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.[0]?.name).toBe("@org/web");
  });

  test("uses targets.build.options.main as entry point when present", () => {
    write("nx.json", JSON.stringify({ version: 2 }));
    write(
      "libs/core/project.json",
      JSON.stringify({
        name: "@org/core",
        sourceRoot: "libs/core/src",
        targets: { build: { options: { main: "libs/core/src/index.ts" } } },
      }),
    );
    write("libs/core/src/index.ts", "");
    const pkgs = nxDetector.detect(root);
    expect(pkgs?.[0]?.entryPoints[0]).toContain("index.ts");
  });
});

// ─── turborepo ────────────────────────────────────────────────────────────────

describe("turborepoDetector", {
  tags: [
    "npm",
    "npmDetector",
    "nx",
    "nxDetector",
    "pnpm",
    "pnpmDetector",
    "turborepo",
    "turborepoDetector",
    "yarn",
    "yarnDetector",
  ],
}, () => {
  test("returns null when turbo.json is absent", () => {
    expect(turborepoDetector.detect(root)).toBeNull();
  });

  test("returns empty array when turbo.json is present (no packages — defers to other detectors)", () => {
    write("turbo.json", JSON.stringify({ pipeline: {} }));
    const pkgs = turborepoDetector.detect(root);
    expect(pkgs).toEqual([]);
  });
});

// ─── gradle ───────────────────────────────────────────────────────────────────

describe("gradleDetector", { tags: ["gradle", "gradleDetector", "jvm"] }, () => {
  test("returns null when no settings.gradle* is present", () => {
    expect(gradleDetector.detect(root)).toBeNull();
  });

  test("returns null for a single-module build (settings.gradle with no include)", () => {
    write("settings.gradle", "rootProject.name = 'app'\n");
    write("src/main/java/com/example/App.java", "package com.example;\nclass App {}\n");
    expect(gradleDetector.detect(root)).toBeNull();
  });

  test("parses Groovy-style include lines into modules", () => {
    write("settings.gradle", "rootProject.name = 'demo'\ninclude ':app', ':core:data'\n");
    write("app/src/main/kotlin/App.kt", "package app\nclass App\n");
    write("core/data/src/main/kotlin/Repo.kt", "package core.data\nclass Repo\n");
    const pkgs = gradleDetector.detect(root);
    expect(pkgs?.map((p) => p.name).sort()).toEqual(["app", "core:data"]);
    const core = pkgs?.find((p) => p.name === "core:data");
    expect(core?.relativeRoot).toBe(path.join("core", "data"));
    expect(core?.entryPoints.some((e) => e.endsWith("Repo.kt"))).toBe(true);
  });

  test("parses Kotlin-DSL include(...) with line wrapping", () => {
    write(
      "settings.gradle.kts",
      'rootProject.name = "demo"\ninclude(\n  ":app",\n  ":libs:util",\n)\n',
    );
    write("app/src/main/java/A.java", "package a;\nclass A {}\n");
    write("libs/util/src/main/java/U.java", "package u;\nclass U {}\n");
    const pkgs = gradleDetector.detect(root);
    expect(pkgs?.map((p) => p.name).sort()).toEqual(["app", "libs:util"]);
  });

  test("ignores commented-out include lines", () => {
    write("settings.gradle", "include ':app'\n// include ':old'\n/* include ':gone' */\n");
    write("app/src/main/java/A.java", "package a;\nclass A {}\n");
    const pkgs = gradleDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toEqual(["app"]);
  });

  test("drops modules that have no source files", () => {
    write("settings.gradle", "include ':app', ':empty'\n");
    write("app/src/main/java/A.java", "package a;\nclass A {}\n");
    fs.mkdirSync(path.join(root, "empty"), { recursive: true });
    const pkgs = gradleDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toEqual(["app"]);
  });

  // Regression for a real dogfooding finding on ktorio/ktor: a custom settings-plugin DSL using
  // Kotlin's unary-plus operator (`+"module-name"`) instead of Gradle's standard
  // `include(":module")` was never recognized as a Gradle monorepo at all — get_workspace_packages
  // errored "not a recognized monorepo root" despite the repo clearly being a multi-module build.
  describe("unary-plus DSL fallback (no standard include(...) present)", () => {
    test("resolves a top-level-only module declared with the unary-plus operator", () => {
      write(
        "settings.gradle.kts",
        'rootProject.name = "demo"\nprojects {\n  shared {\n    +"core-http"\n  }\n}\n',
      );
      write("core-http/src/main/kotlin/Client.kt", "package core.http\nclass Client\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["core-http"]);
      expect(pkgs?.[0]?.relativeRoot).toBe("core-http");
    });

    test("resolves a module nested one level under a differently-named container directory", () => {
      // Mirrors ktor's real shape: the `server { }` block's modules live under a `ktor-server/`
      // directory, not a `server/` directory — the block name doesn't become a path prefix, so
      // this can only work by basename search, not by computing a path from the DSL structure.
      write(
        "settings.gradle.kts",
        'rootProject.name = "demo"\nprojects {\n  server {\n    +"server-core"\n  }\n}\n',
      );
      write("my-server/server-core/src/main/kotlin/Core.kt", "package server.core\nclass Core\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["server-core"]);
      expect(pkgs?.[0]?.relativeRoot).toBe(path.join("my-server", "server-core"));
    });

    test("resolves a module nested inside an `including { }` sub-block", () => {
      write(
        "settings.gradle.kts",
        [
          'rootProject.name = "demo"',
          "projects {",
          "  server {",
          '    +"server-core" including {',
          '      +"server-core-test"',
          "    }",
          "  }",
          "}",
        ].join("\n"),
      );
      write("server/server-core/src/main/kotlin/Core.kt", "package server.core\nclass Core\n");
      write(
        "server/server-core/server-core-test/src/main/kotlin/Test.kt",
        "package server.core.test\nclass Test\n",
      );
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name).sort()).toEqual(["server-core", "server-core-test"]);
    });

    test("standard include(...) still takes precedence when both forms are somehow present", () => {
      write(
        "settings.gradle.kts",
        'include(":app")\nprojects {\n  shared {\n    +"unused-module"\n  }\n}\n',
      );
      write("app/src/main/kotlin/App.kt", "package app\nclass App\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["app"]);
    });

    test("a module name with no matching directory anywhere is silently skipped", () => {
      write(
        "settings.gradle.kts",
        'projects {\n  shared {\n    +"core-http"\n    +"nonexistent-module"\n  }\n}\n',
      );
      write("core-http/src/main/kotlin/Client.kt", "package core.http\nclass Client\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["core-http"]);
    });

    test("returns null when no unary-plus module resolves to a real directory with sources", () => {
      write("settings.gradle.kts", 'projects {\n  shared {\n    +"nonexistent-module"\n  }\n}\n');
      expect(gradleDetector.detect(root)).toBeNull();
    });

    // On a basename collision, a directory with its own build.gradle(.kts) is the strongest real
    // "this is a Gradle module" signal — prefer it even over a shorter, build-file-less path that
    // would otherwise win on the shortest-path tiebreak alone.
    test("prefers a directory with its own build.gradle(.kts) over a shorter path without one, on a basename collision", () => {
      write("settings.gradle.kts", 'projects {\n  shared {\n    +"core"\n  }\n}\n');
      // Shorter path, no build file — a decoy directory that merely shares the module's basename.
      write("core/README.md", "not a module\n");
      write("core/src/main/java/Unrelated.java", "class Unrelated {}\n");
      // Longer path, has its own build.gradle.kts — the real module.
      write("modules/nested/core/build.gradle.kts", "// real module\n");
      write("modules/nested/core/src/main/kotlin/Core.kt", "package core\nclass Core\n");

      const pkgs = gradleDetector.detect(root);
      const core = pkgs?.find((p) => p.name === "core");
      expect(core?.relativeRoot).toBe(path.join("modules", "nested", "core"));
    });
  });

  // Issue 22: includeBuild(...) (composite builds) uses filesystem paths, a distinct mechanism
  // from include(...)'s colon-prefixed project paths, and was previously not parsed at all.
  describe("includeBuild (composite builds)", () => {
    test("resolves an in-root includeBuild target as its own package, alongside include(...)", () => {
      write(
        "settings.gradle.kts",
        'rootProject.name = "demo"\ninclude(":app")\nincludeBuild("shared-lib")\n',
      );
      write("app/src/main/kotlin/App.kt", "package app\nclass App\n");
      write("shared-lib/src/main/kotlin/Shared.kt", "package shared\nclass Shared\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name).sort()).toEqual(["app", "shared-lib"]);
      const shared = pkgs?.find((p) => p.name === "shared-lib");
      expect(shared?.relativeRoot).toBe("shared-lib");
    });

    test("resolves includeBuild with the Groovy single-quote form and a configuration lambda", () => {
      write("settings.gradle", "includeBuild('shared-lib') {\n  dependencySubstitution { }\n}\n");
      write("shared-lib/src/main/java/Shared.java", "package shared;\nclass Shared {}\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["shared-lib"]);
    });

    test("a relative includeBuild target that escapes rootDir is skipped, not guessed at", () => {
      write("settings.gradle.kts", 'include(":app")\nincludeBuild("../shared-lib")\n');
      write("app/src/main/kotlin/App.kt", "package app\nclass App\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["app"]);
    });

    test("an absolute includeBuild target outside rootDir is skipped, not guessed at", () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-composite-"));
      try {
        fs.mkdirSync(path.join(outside, "src/main/kotlin"), { recursive: true });
        fs.writeFileSync(
          path.join(outside, "src/main/kotlin/External.kt"),
          "package external\nclass External\n",
        );
        write(
          "settings.gradle.kts",
          `include(":app")\nincludeBuild("${outside.replace(/\\/g, "\\\\")}")\n`,
        );
        write("app/src/main/kotlin/App.kt", "package app\nclass App\n");
        const pkgs = gradleDetector.detect(root);
        expect(pkgs?.map((p) => p.name)).toEqual(["app"]);
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    test("returns null when includeBuild is the only module declaration and its target has no sources", () => {
      write("settings.gradle.kts", 'includeBuild("empty-build")\n');
      fs.mkdirSync(path.join(root, "empty-build"), { recursive: true });
      expect(gradleDetector.detect(root)).toBeNull();
    });

    test("fires the detector from includeBuild alone, with no include(...) or unary-plus present", () => {
      write("settings.gradle.kts", 'rootProject.name = "demo"\nincludeBuild("shared-lib")\n');
      write("shared-lib/src/main/kotlin/Shared.kt", "package shared\nclass Shared\n");
      const pkgs = gradleDetector.detect(root);
      expect(pkgs?.map((p) => p.name)).toEqual(["shared-lib"]);
    });
  });
});

// ─── sbt ──────────────────────────────────────────────────────────────────────

describe("sbtDetector", { tags: ["sbt", "sbtDetector", "jvm"] }, () => {
  test("returns null when build.sbt or project/ is missing", () => {
    write("build.sbt", 'name := "root"\n');
    expect(sbtDetector.detect(root)).toBeNull();
  });

  test("returns null for a single-project build (no sub-projects)", () => {
    write("build.sbt", 'name := "root"\nscalaVersion := "3.3.1"\n');
    write("project/build.properties", "sbt.version=1.9.8\n");
    write("src/main/scala/Main.scala", "package main\nobject Main\n");
    expect(sbtDetector.detect(root)).toBeNull();
  });

  test("parses project.in(file(...)) definitions", () => {
    write(
      "build.sbt",
      'lazy val core = project.in(file("core"))\nlazy val app = (project in file("modules/app"))\n',
    );
    write("project/build.properties", "sbt.version=1.9.8\n");
    write("core/src/main/scala/Core.scala", "package core\nobject Core\n");
    write("modules/app/src/main/scala/App.scala", "package app\nobject App\n");
    const pkgs = sbtDetector.detect(root);
    expect(pkgs?.map((p) => p.name).sort()).toEqual(["app", "core"]);
    const app = pkgs?.find((p) => p.name === "app");
    expect(app?.relativeRoot).toBe(path.join("modules", "app"));
  });

  test("defaults the directory to the val name when no file(...) is given", () => {
    write("build.sbt", "lazy val util = project\n");
    write("project/build.properties", "sbt.version=1.9.8\n");
    write("util/src/main/scala/U.scala", "package util\nobject U\n");
    const pkgs = sbtDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toEqual(["util"]);
    expect(pkgs?.[0]?.relativeRoot).toBe("util");
  });

  test('drops the root aggregate (project in file("."))', () => {
    write(
      "build.sbt",
      'lazy val root = (project in file("."))\nlazy val core = project.in(file("core"))\n',
    );
    write("project/build.properties", "sbt.version=1.9.8\n");
    write("core/src/main/scala/C.scala", "package core\nobject C\n");
    const pkgs = sbtDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toEqual(["core"]);
  });

  test("reads sub-project definitions from project/*.scala", () => {
    write("build.sbt", 'name := "root"\n');
    write("project/build.properties", "sbt.version=1.9.8\n");
    write("project/Build.scala", 'object B {\n  lazy val svc = project.in(file("svc"))\n}\n');
    write("svc/src/main/scala/S.scala", "package svc\nobject S\n");
    const pkgs = sbtDetector.detect(root);
    expect(pkgs?.map((p) => p.name)).toEqual(["svc"]);
  });
});
