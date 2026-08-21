import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Graph } from "../graph/model";
import type { FileNode, StructuredTag } from "../types/node";
import { applyTags, applyTagsToFile } from "./applier";
import { createStrategies } from "./strategies";

function makeNode(
  p: string,
  tags: StructuredTag[] = [],
  category: FileNode["category"] = "test",
): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    imports: [],
    exports: [],
    tags,
    mtime: 1000,
    size: 100,
  };
}

function makeGraph(nodes: FileNode[]): Graph {
  const map = new Map<string, FileNode>();
  for (const n of nodes) map.set(n.path, n);
  return new Graph(map);
}

describe("applyTagsToFile", {
  tags: ["applier", "applyTagsToFile", "tags"],
}, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mokosh-applier-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("returns status error when the file can't be read", async () => {
    const absPath = path.join(dir, "missing.test.ts");
    const strategies = createStrategies("vitest");
    const result = await applyTagsToFile(absPath, ["auth"], false, strategies);
    expect(result.status).toBe("error");
    expect(result.error).toBeTruthy();
  });

  test("returns status unchanged when no strategy matches the extension", async () => {
    const absPath = path.join(dir, "notes.txt");
    await fs.writeFile(absPath, "hello", "utf8");
    const strategies = createStrategies("vitest");
    const result = await applyTagsToFile(absPath, ["auth"], false, strategies);
    expect(result.status).toBe("unchanged");
    expect(await fs.readFile(absPath, "utf8")).toBe("hello");
  });

  test("returns status unchanged when the strategy produces no change", async () => {
    const absPath = path.join(dir, "login.test.ts");
    await fs.writeFile(absPath, 'test("login", () => {});\n', "utf8");
    const strategies = createStrategies("vitest");
    const result = await applyTagsToFile(absPath, [], false, strategies);
    expect(result.status).toBe("unchanged");
  });

  test("writes the updated content and returns status updated", async () => {
    const absPath = path.join(dir, "login.test.ts");
    await fs.writeFile(absPath, 'test("login", () => {});\n', "utf8");
    const strategies = createStrategies("vitest");
    const result = await applyTagsToFile(absPath, ["auth"], false, strategies);
    expect(result.status).toBe("updated");
    const written = await fs.readFile(absPath, "utf8");
    expect(written).toContain('tags: ["auth"]');
  });

  test("dryRun computes the change but skips the disk write", async () => {
    const absPath = path.join(dir, "login.test.ts");
    const original = 'test("login", () => {});\n';
    await fs.writeFile(absPath, original, "utf8");
    const strategies = createStrategies("vitest");
    const result = await applyTagsToFile(absPath, ["auth"], true, strategies);
    expect(result.status).toBe("updated");
    expect(await fs.readFile(absPath, "utf8")).toBe(original);
  });
});

describe("applyTags", {
  tags: ["applier", "applyTags", "tags"],
}, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mokosh-applier-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  test("skips non-test nodes entirely", async () => {
    const graph = makeGraph([makeNode("src/foo.ts", [{ name: "auth", kind: "import" }], "logic")]);
    const result = await applyTags(graph, dir, { dryRun: true });
    expect(result.files).toHaveLength(0);
    expect(result).toMatchObject({ updated: 0, unchanged: 0, errors: 0 });
  });

  test("filters tags by kind, name validity, and the generic blocklist, then dedupes and sorts", async () => {
    const relPath = "src/login.test.ts";
    const absPath = path.join(dir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, 'test("login", () => {});\n', "utf8");

    const tags: StructuredTag[] = [
      { name: "zeta", kind: "import" },
      { name: "auth", kind: "import" },
      { name: "auth", kind: "import" }, // duplicate, should collapse
      { name: "utils", kind: "import" }, // generic, blocklisted
      { name: "@internal", kind: "comment-marker" }, // wrong kind, excluded
      { name: "session", kind: "function" }, // wrong kind, excluded
      { name: "1invalid", kind: "import" }, // fails VALID_TAG_NAME_RE (starts with digit)
    ];
    const graph = makeGraph([makeNode(relPath, tags)]);

    const result = await applyTags(graph, dir, { dryRun: false });
    expect(result.updated).toBe(1);
    expect(result.files[0]).toMatchObject({ path: relPath, status: "updated" });

    const written = await fs.readFile(absPath, "utf8");
    expect(written).toContain('tags: ["auth", "zeta"]');
  });

  test("reports unchanged when computed tags produce no diff, and error on unreadable files", async () => {
    const okPath = "src/plain.test.ts";
    const okAbs = path.join(dir, okPath);
    await fs.mkdir(path.dirname(okAbs), { recursive: true });
    await fs.writeFile(okAbs, 'test("plain", () => {});\n', "utf8");

    const missingPath = "src/missing.test.ts";

    const graph = makeGraph([
      makeNode(okPath, []),
      makeNode(missingPath, [{ name: "auth", kind: "import" }]),
    ]);

    const result = await applyTags(graph, dir, { dryRun: false });
    expect(result.unchanged).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.updated).toBe(0);

    const unchangedResult = result.files.find((f) => f.path === okPath);
    const errorResult = result.files.find((f) => f.path === missingPath);
    expect(unchangedResult?.status).toBe("unchanged");
    expect(errorResult?.status).toBe("error");
    expect(errorResult?.error).toBeTruthy();
  });

  test("honors tagApplier.framework from mokosh.config.json", async () => {
    await fs.writeFile(
      path.join(dir, "mokosh.config.json"),
      JSON.stringify({ tagApplier: { framework: "playwright" } }),
      "utf8",
    );
    const relPath = "e2e/login.spec.ts";
    const absPath = path.join(dir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, 'test("login", () => {});\n', "utf8");

    const graph = makeGraph([makeNode(relPath, [{ name: "auth", kind: "import" }])]);
    const result = await applyTags(graph, dir, { dryRun: false });
    expect(result.updated).toBe(1);

    const written = await fs.readFile(absPath, "utf8");
    expect(written).toContain('tag: ["@auth"]');
  });
});
