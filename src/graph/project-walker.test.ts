import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ProjectWalker } from "./project-walker";

let root: string;
const write = (rel: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "x");
  return abs;
};
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-walker-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ProjectWalker.collectFiles", () => {
  test("collects matching files recursively and skips ignored directories", () => {
    const keep = write("src/a.test.ts");
    const deep = write("src/deep/b.test.ts");
    write("src/c.ts");
    write("node_modules/dep/d.test.ts");
    const walker = new ProjectWalker(root, new Set(["node_modules"]), false);
    const found = walker.collectFiles(root, (e) => e.name.includes(".test."));
    expect(found.sort()).toEqual([deep, keep].sort());
  });

  test("an unreadable or missing scan root yields no files instead of throwing", () => {
    const walker = new ProjectWalker(root, new Set(), false);
    expect(walker.collectFiles(path.join(root, "missing"), () => true)).toEqual([]);
  });

  test("skips nested git repos unless includeNestedRepos is set", () => {
    const nested = write("vendor/lib/.git/HEAD");
    expect(nested).toBeTruthy();
    const inner = write("vendor/lib/inner.ts");
    const skipping = new ProjectWalker(root, new Set(), false).collectFiles(root, (e) =>
      e.name.endsWith(".ts"),
    );
    expect(skipping).not.toContain(inner);
    const including = new ProjectWalker(root, new Set(), true).collectFiles(root, (e) =>
      e.name.endsWith(".ts"),
    );
    expect(including).toContain(inner);
  });
});

describe("ProjectWalker.hasAtLeastFiles", () => {
  test("stops at the threshold and ignores files in ignored directories", () => {
    write("a.ts");
    write("b.ts");
    write("node_modules/x.ts");
    const walker = new ProjectWalker(root, new Set(["node_modules"]), false);
    expect(walker.hasAtLeastFiles(root, 2)).toBe(true);
    expect(walker.hasAtLeastFiles(root, 3)).toBe(false);
  });
});

describe("ProjectWalker.crossesIntoNestedRepo", () => {
  test("true only when the target sits in a nested repo the importer is not part of", () => {
    write("vendor/lib/.git/HEAD");
    const inRepo = write("vendor/lib/x.ts");
    const outside = write("src/y.ts");
    const walker = new ProjectWalker(root, new Set(), false);
    expect(walker.crossesIntoNestedRepo(outside, inRepo)).toBe(true);
    expect(walker.crossesIntoNestedRepo(inRepo, inRepo)).toBe(false);
    expect(walker.crossesIntoNestedRepo(inRepo, outside)).toBe(false);
    expect(new ProjectWalker(root, new Set(), true).crossesIntoNestedRepo(outside, inRepo)).toBe(
      false,
    );
  });
});
