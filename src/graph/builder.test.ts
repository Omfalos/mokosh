import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
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
