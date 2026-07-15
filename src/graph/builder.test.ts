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
