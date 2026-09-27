import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createImportMap } from "../index";

describe("GraphBuilder test-file discovery scoping", () => {
  test("does not pull in unrelated sibling test files outside the entry points' subtree", async () => {
    const root = path.join(process.cwd(), "test-builder-scope");
    fs.mkdirSync(path.join(root, "project-a", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "project-b"), { recursive: true });

    fs.writeFileSync(path.join(root, "project-a", "src", "index.js"), "export const a = 1;");
    fs.writeFileSync(
      path.join(root, "project-a", "src", "index.test.js"),
      "import '../src/index.js';",
    );
    fs.writeFileSync(path.join(root, "project-b", "other.test.js"), "");

    try {
      const graph = await createImportMap(root, ["project-a/src/index.js"]);
      const paths = graph.serialize().nodes.map((n) => n.path);

      expect(paths).toContain("project-a/src/index.test.js");
      expect(paths).not.toContain("project-b/other.test.js");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("still discovers a conventional top-level tests/ directory sibling to the entry point", async () => {
    const root = path.join(process.cwd(), "test-builder-scope-tests-dir");
    fs.mkdirSync(path.join(root, "project-a", "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "project-a", "tests"), { recursive: true });

    fs.writeFileSync(path.join(root, "project-a", "src", "index.js"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "project-a", "tests", "index.test.js"), "");

    try {
      const graph = await createImportMap(root, ["project-a/src/index.js"]);
      const paths = graph.serialize().nodes.map((n) => n.path);

      expect(paths).toContain("project-a/tests/index.test.js");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GraphBuilder ignore-dir handling", () => {
  test("a markdown doc referencing a file under an ignored dir does not add that file as a node", async () => {
    const root = path.join(process.cwd(), "test-builder-ignore-md");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.mkdirSync(path.join(root, "coverage"), { recursive: true });

    fs.writeFileSync(path.join(root, "src", "index.js"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "dist", "bundle.js"), "module.exports = {};");
    fs.writeFileSync(path.join(root, "coverage", "coverage-summary.json"), "{}");
    fs.writeFileSync(
      path.join(root, "README.md"),
      "See `dist/bundle.js` for the build output and `coverage/coverage-summary.json` for coverage.",
    );

    try {
      const graph = await createImportMap(root, ["src/index.js"]);
      const paths = graph.serialize().nodes.map((n) => n.path);

      expect(paths).toContain("README.md");
      expect(paths).not.toContain("dist/bundle.js");
      expect(paths).not.toContain("coverage/coverage-summary.json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("MOKOSH_IGNORE_DIRS env var excludes matching directories from doc discovery", async () => {
    const root = path.join(process.cwd(), "test-builder-env-ignore");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "index.js"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "notes", "todo.md"), "# Todo");

    const prev = process.env.MOKOSH_IGNORE_DIRS;
    process.env.MOKOSH_IGNORE_DIRS = "notes";
    try {
      const graph = await createImportMap(root, ["src/index.js"]);
      expect(graph.serialize().nodes.map((n) => n.path)).not.toContain("notes/todo.md");
    } finally {
      if (prev === undefined) delete process.env.MOKOSH_IGNORE_DIRS;
      else process.env.MOKOSH_IGNORE_DIRS = prev;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("additionalIgnoreDirs excludes matching directories from doc discovery", async () => {
    const root = path.join(process.cwd(), "test-builder-additional-ignore");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });

    fs.writeFileSync(path.join(root, "src", "index.js"), "export const a = 1;");
    fs.writeFileSync(path.join(root, "docs", "guide.md"), "# Guide");

    try {
      const withDocs = await createImportMap(root, ["src/index.js"]);
      expect(withDocs.serialize().nodes.map((n) => n.path)).toContain("docs/guide.md");

      const withoutDocs = await createImportMap(root, ["src/index.js"], null, {
        additionalIgnoreDirs: ["docs"],
      });
      expect(withoutDocs.serialize().nodes.map((n) => n.path)).not.toContain("docs/guide.md");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn().mockReturnValue("") };
});

describe("GraphBuilder gitStats batching", () => {
  test("issues a constant number of git invocations regardless of file count, instead of one per file", async () => {
    const root = path.join(process.cwd(), "test-builder-gitstats-batching");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    fs.writeFileSync(path.join(root, "src", "a.js"), "import './b.js';export const a = 1;");
    fs.writeFileSync(path.join(root, "src", "b.js"), "import './c.js';export const b = 1;");
    fs.writeFileSync(path.join(root, "src", "c.js"), "import './d.js';export const c = 1;");
    fs.writeFileSync(path.join(root, "src", "d.js"), "import './e.js';export const d = 1;");
    fs.writeFileSync(path.join(root, "src", "e.js"), "export const e = 1;");

    vi.mocked(execFileSync).mockClear();

    try {
      const graph = await createImportMap(root, ["src/a.js"], null, { gitStats: true });
      const paths = graph.serialize().nodes.map((n) => n.path);
      expect(paths).toEqual(
        expect.arrayContaining(["src/a.js", "src/b.js", "src/c.js", "src/d.js", "src/e.js"]),
      );

      // getRepoGitStats issues exactly two git log calls (bounded + full-history fallback)
      // per build, no matter how many files were reachable — not one call per file.
      expect(execFileSync).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GraphBuilder JVM dependency versions", () => {
  test("annotates an external JVM import with the version from a Gradle catalog by longest group-prefix", async () => {
    const root = path.join(process.cwd(), "test-builder-jvm-versions");
    fs.mkdirSync(path.join(root, "gradle"), { recursive: true });
    fs.mkdirSync(path.join(root, "app", "src", "main", "kotlin", "com", "example", "app"), {
      recursive: true,
    });

    // The heuristic fires when the FQN import starts with the full Maven group id — as it does
    // for `org.junit.jupiter.*` under group `org.junit.jupiter`. Package names that diverge from
    // the group id (e.g. `okhttp3` vs `com.squareup.okhttp3`) stay unversioned by design.
    fs.writeFileSync(
      path.join(root, "gradle", "libs.versions.toml"),
      `[libraries]\njunit = "org.junit.jupiter:junit-jupiter:5.10.2"\n`,
    );
    fs.writeFileSync(
      path.join(root, "app", "src", "main", "kotlin", "com", "example", "app", "Client.kt"),
      "package com.example.app\n\nimport org.junit.jupiter.api.Test\n\nclass Client\n",
    );

    try {
      const graph = await createImportMap(root, ["app/src/main/kotlin/com/example/app/Client.kt"]);
      const node = graph.serialize().nodes.find((n) => n.path.endsWith("Client.kt"));
      const junitEdge = node?.imports.find((e) => e.rawSpecifier === "org.junit.jupiter.api.Test");

      expect(junitEdge?.isExternal).toBe(true);
      expect(junitEdge?.version).toBe("5.10.2");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GraphBuilder Go same-package edges", () => {
  // Regression for the mokosh dogfooding finding on gin-gonic/gin: Go files in one package
  // reference each other's types/functions with no `import` line (normal Go — sibling files in
  // a package compile together), so without a synthetic same-package edge those siblings are
  // unreachable from the entry point and find_unused wrongly flags them as unused.
  test("a package sibling reachable only through unimported same-package references is not unused", async () => {
    const root = path.join(process.cwd(), "test-builder-go-same-package");
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });

    fs.writeFileSync(root + "/go.mod", "module example.com/app\n\ngo 1.22\n");
    // Config is never imported by main.go, but main.go references it with no import line —
    // exactly the Go same-package idiom.
    fs.writeFileSync(path.join(root, "pkg", "config.go"), "package pkg\n\ntype Config struct{}\n");
    fs.writeFileSync(
      path.join(root, "pkg", "main.go"),
      "package pkg\n\nfunc New() *Config {\n\treturn &Config{}\n}\n",
    );

    try {
      const graph = await createImportMap(root, ["pkg/main.go"]);
      const paths = graph.serialize().nodes.map((n) => n.path);

      expect(paths).toContain(path.join("pkg", "config.go"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("GraphBuilder local-edge deduplication", () => {
  // Go's resolver expands a package import into every non-test file in that package's
  // directory (one edge per file) on every use of the import — a file that references the
  // package's symbols multiple times would otherwise get one full copy of those edges per
  // reference. Go isn't the only resolver with this expand-to-many-files shape (JVM has the
  // same behavior for package-level imports), so the dedup applies to every language, not just
  // JVM — this test covers Go specifically since it was the one found under-deduped.
  test("collapses a Go package import used multiple times in one file to one edge per target file", async () => {
    const root = path.join(process.cwd(), "test-builder-go-dedup");
    fs.mkdirSync(path.join(root, "pkg"), { recursive: true });

    fs.writeFileSync(path.join(root, "go.mod"), "module example.com/app\n\ngo 1.22\n");
    fs.writeFileSync(path.join(root, "pkg", "a.go"), "package pkg\n\nfunc A() {}\n");
    fs.writeFileSync(path.join(root, "pkg", "b.go"), "package pkg\n\nfunc B() {}\n");
    fs.writeFileSync(
      path.join(root, "main.go"),
      [
        "package main",
        "",
        'import "example.com/app/pkg"',
        "",
        "func main() {",
        "\tpkg.A()",
        "\tpkg.B()",
        "\tpkg.A()",
        "}",
      ].join("\n"),
    );

    try {
      const graph = await createImportMap(root, ["main.go"]);
      const node = graph.serialize().nodes.find((n) => n.path === "main.go");
      const localEdges = node?.imports.filter((e) => !e.isExternal) ?? [];
      const targets = localEdges.map((e) => e.toPath);

      // One edge per distinct target file (a.go, b.go) — not one per (import usage x file).
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets.sort()).toEqual([path.join("pkg", "a.go"), path.join("pkg", "b.go")].sort());
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Deduping must NOT collapse a "re-export" edge with an ordinary import of the same target
  // into one merged edge: get_api_surface (src/graph/api-surface.ts) trusts a "re-export" edge's
  // `symbols` as the file's *complete* public re-export list for that target, so merging it with
  // an unrelated plain import's symbols would silently promote a non-re-exported name into the
  // public API (see docs/known_issues and the Python re-export fix this regression-guards).
  test("a file that both imports and re-exports the same target keeps two separate edges", async () => {
    const root = path.join(process.cwd(), "test-builder-reexport-dedup");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    fs.writeFileSync(path.join(root, "src", "helper.js"), "export const helper = () => {};");
    fs.writeFileSync(
      path.join(root, "src", "index.js"),
      "import { helper } from './helper.js';\nexport { helper } from './helper.js';\nhelper();",
    );

    try {
      const graph = await createImportMap(root, ["src/index.js"]);
      const node = graph.serialize().nodes.find((n) => n.path === path.join("src", "index.js"));
      const helperEdges = node?.imports.filter((e) => e.toPath?.endsWith("helper.js")) ?? [];

      expect(helperEdges).toHaveLength(2);
      const types = helperEdges.map((e) => e.type).sort();
      expect(types).toEqual(["re-export", "static"]);
      const reexportEdge = helperEdges.find((e) => e.type === "re-export");
      expect(reexportEdge?.symbols).toEqual(["helper"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // Regression for the real bug this fix closes: a re-export and a plain import from the SAME
  // submodule, with DIFFERENT symbols, must not merge — merging would leak the plain-imported
  // name into get_api_surface's public export list. Caught in review of the Python re-export fix
  // via a full createImportMap -> buildApiSurface pipeline test (see api-surface.test.ts); this
  // is the narrower unit-level guard directly on dedupeLocalEdges's behavior.
  test("does not leak a plain-imported symbol into the re-export edge's symbols when they share a target", async () => {
    const root = path.join(process.cwd(), "test-builder-reexport-dedup-mixed");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });

    fs.writeFileSync(
      path.join(root, "src", "x.js"),
      "export const Public = 1;\nexport const internal = 2;",
    );
    fs.writeFileSync(
      path.join(root, "src", "index.js"),
      "import { internal } from './x.js';\nexport { Public } from './x.js';\ninternal;",
    );

    try {
      const graph = await createImportMap(root, ["src/index.js"]);
      const node = graph.serialize().nodes.find((n) => n.path === path.join("src", "index.js"));
      const xEdges = node?.imports.filter((e) => e.toPath?.endsWith("x.js")) ?? [];

      expect(xEdges).toHaveLength(2);
      const reexportEdge = xEdges.find((e) => e.type === "re-export");
      const staticEdge = xEdges.find((e) => e.type !== "re-export");

      expect(reexportEdge?.symbols).toEqual(["Public"]);
      expect(staticEdge?.symbols).toEqual(["internal"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
