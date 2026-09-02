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
