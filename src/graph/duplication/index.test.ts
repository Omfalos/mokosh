import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { FileType } from "../../types/parse";
import { Graph } from "../model";
import { findDuplicates } from "./index";
import { loadTokenCacheFromDisk, saveTokenCacheToDisk } from "./token-cache-store";

function setup(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-duplication-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function graphFor(paths: Array<[string, FileType]>): Graph {
  const nodes = paths.map(([p, type]) => ({
    path: p,
    type,
    category: "logic" as const,
    imports: [],
    exports: [],
    tags: [],
    mtime: 0,
    size: 0,
  }));
  return Graph.deserialize({ nodes });
}

describe("findDuplicates", () => {
  let root: string;

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("finds a renamed-variable duplicate across two TypeScript files", async () => {
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");
    root = setup({
      "a.ts": block,
      "b.ts": block.replace(/computeTotal/g, "calculateSum").replace(/items/g, "orders"),
    });
    const graph = graphFor([
      ["a.ts", "typescript"],
      ["b.ts", "typescript"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 4, windowSize: 8 });
    expect(groups.length).toBeGreaterThan(0);
    const files = groups[0]?.occurrences.map((o) => o.file).sort();
    expect(files).toEqual(["a.ts", "b.ts"]);
  });

  test("works across languages — TypeScript and Python, independently", async () => {
    const tsBlock = [
      "function greet(name) {",
      "  console.log('hello ' + name);",
      "  console.log('goodbye ' + name);",
      "  return name;",
      "}",
    ].join("\n");
    const pyBlock = [
      "def greet(name):",
      "    print('hello ' + name)",
      "    print('goodbye ' + name)",
      "    return name",
    ].join("\n");
    root = setup({
      "one.ts": tsBlock,
      "two.ts": tsBlock,
      "one.py": pyBlock,
      "two.py": pyBlock,
    });
    const graph = graphFor([
      ["one.ts", "typescript"],
      ["two.ts", "typescript"],
      ["one.py", "python"],
      ["two.py", "python"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 3, windowSize: 6 });
    const tsGroup = groups.find((g) => g.occurrences.every((o) => o.file.endsWith(".ts")));
    const pyGroup = groups.find((g) => g.occurrences.every((o) => o.file.endsWith(".py")));
    expect(tsGroup).toBeDefined();
    expect(pyGroup).toBeDefined();
    // no cross-language matches
    expect(
      groups.some(
        (g) =>
          g.occurrences.some((o) => o.file.endsWith(".ts")) &&
          g.occurrences.some((o) => o.file.endsWith(".py")),
      ),
    ).toBe(false);
  });

  test("respects minLines and limit options", async () => {
    const block = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n");
    root = setup({ "a.ts": block, "b.ts": block });
    const graph = graphFor([
      ["a.ts", "typescript"],
      ["b.ts", "typescript"],
    ]);

    const tooStrict = await findDuplicates(graph, root, { minLines: 100 });
    expect(tooStrict.groups).toHaveLength(0);

    const limited = await findDuplicates(graph, root, { minLines: 2, limit: 1 });
    expect(limited.groups.length).toBeLessThanOrEqual(1);
  });

  test("skips files listed in the graph but missing on disk instead of throwing", async () => {
    root = setup({ "a.ts": "const a = 1;" });
    const graph = graphFor([
      ["a.ts", "typescript"],
      ["missing.ts", "typescript"],
    ]);

    await expect(findDuplicates(graph, root)).resolves.toEqual({ groups: [] });
  });

  test("always excludes lock files, even though their repeated structure would otherwise match", async () => {
    const lockBlock = Array.from(
      { length: 20 },
      (_, i) => `    "pkg${i}": { "version": "1.0.${i}", "resolved": "https://x/${i}" },`,
    ).join("\n");
    root = setup({
      "package-lock.json": `{\n${lockBlock}\n}`,
      "yarn.lock": lockBlock,
      "pnpm-lock.yaml": lockBlock,
    });
    const graph = graphFor([
      ["package-lock.json", "unknown"],
      ["yarn.lock", "unknown"],
      ["pnpm-lock.yaml", "unknown"],
    ]);

    await expect(findDuplicates(graph, root, { minLines: 3 })).resolves.toEqual({ groups: [] });
  });

  test("excludes files under a default-ignored directory (e.g. dist)", async () => {
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");
    root = setup({
      "dist/bundle.js": block,
      "src/bundle.js": block,
    });
    const graph = graphFor([
      ["dist/bundle.js", "javascript"],
      ["src/bundle.js", "javascript"],
    ]);

    await expect(findDuplicates(graph, root, { minLines: 3 })).resolves.toEqual({ groups: [] });
  });

  test("respects a custom ignoreDirs list", async () => {
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");
    root = setup({
      "vendor/bundle.js": block,
      "src/bundle.js": block,
    });
    const graph = graphFor([
      ["vendor/bundle.js", "javascript"],
      ["src/bundle.js", "javascript"],
    ]);

    // "vendor" isn't in DEFAULT_IGNORE_DIRS, so by default it's still scanned...
    const withDefaults = await findDuplicates(graph, root, { minLines: 3 });
    expect(withDefaults.groups.length).toBeGreaterThan(0);

    // ...but an explicit ignoreDirs excludes it.
    const withCustom = await findDuplicates(graph, root, { minLines: 3, ignoreDirs: ["vendor"] });
    expect(withCustom.groups).toEqual([]);
  });

  test("does not match CSS rules with the same declaration shape but different values (ADR-013)", async () => {
    root = setup({
      "a.css": [".header {", "  display: flex;", "  color: red;", "}"].join("\n"),
      "b.css": [".footer {", "  display: block;", "  color: blue;", "}"].join("\n"),
    });
    const graph = graphFor([
      ["a.css", "css"],
      ["b.css", "css"],
    ]);

    await expect(findDuplicates(graph, root, { minLines: 2 })).resolves.toEqual({ groups: [] });
  });

  test("matches CSS rules with different selectors but an identical declaration body", async () => {
    root = setup({
      "a.css": [".header {", "  display: flex;", "  align-items: center;", "}"].join("\n"),
      "b.css": [".footer {", "  display: flex;", "  align-items: center;", "}"].join("\n"),
    });
    const graph = graphFor([
      ["a.css", "css"],
      ["b.css", "css"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 2 });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.family).toBe("style");
  });

  test("never matches across the style/code family boundary, even with identical shape", async () => {
    // CSS is matched structurally now (by literal declaration content, via
    // findStyleBlockDuplicates), so this exercises that a genuine CSS duplicate and a genuine
    // TS duplicate never get paired with each other, not that they'd otherwise collide on shape.
    const cssBlock = [
      ".header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "}",
    ].join("\n");
    const tsBlock = [
      "function header() {",
      "  display(flexValue);",
      "  alignItems(centerValue);",
      "  justifyContent(spaceValue);",
      "}",
    ].join("\n");
    root = setup({
      "a.css": cssBlock,
      "b.css": cssBlock,
      "a.ts": tsBlock,
      "b.ts": tsBlock,
    });
    const graph = graphFor([
      ["a.css", "css"],
      ["b.css", "css"],
      ["a.ts", "typescript"],
      ["b.ts", "typescript"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 3, windowSize: 6 });

    // Each family's genuine within-family duplicate is still found...
    const cssGroup = groups.find((g) => g.occurrences.every((o) => o.file.endsWith(".css")));
    const tsGroup = groups.find((g) => g.occurrences.every((o) => o.file.endsWith(".ts")));
    expect(cssGroup?.family).toBe("style");
    expect(tsGroup?.family).toBe("code");

    // ...but no group ever pairs a style file with a code file.
    expect(
      groups.some(
        (g) =>
          g.occurrences.some((o) => o.file.endsWith(".css")) &&
          g.occurrences.some((o) => o.file.endsWith(".ts")),
      ),
    ).toBe(false);
  });

  test("reports a block repeated across four files as one group, not six pairs (ADR-013)", async () => {
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");
    root = setup({ "a.ts": block, "b.ts": block, "c.ts": block, "d.ts": block });
    const graph = graphFor([
      ["a.ts", "typescript"],
      ["b.ts", "typescript"],
      ["c.ts", "typescript"],
      ["d.ts", "typescript"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 4, windowSize: 8 });
    const clones = groups.filter((g) => g.occurrences.every((o) => o.file.endsWith(".ts")));
    expect(clones).toHaveLength(1);
    expect(clones[0]?.occurrences.map((o) => o.file).sort()).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
    ]);
  });

  test("gates out MCP-tool-schema-shaped object-literal boilerplate but keeps real duplicated logic (ADR-013)", async () => {
    const schema = [
      "export const tool = {",
      '  root: { type: "string", description: "Absolute path to the project root" },',
      '  minLines: { type: "number", description: "Minimum block size" },',
      '  limit: { type: "number", description: "Max results to return" },',
      '  ignoreDirs: { type: "array", items: { type: "string" }, description: "Excluded dirs" },',
      "};",
    ].join("\n");
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");
    root = setup({
      "schema-a.ts": schema,
      "schema-b.ts": schema,
      "logic-a.ts": block,
      "logic-b.ts": block,
    });
    const graph = graphFor([
      ["schema-a.ts", "typescript"],
      ["schema-b.ts", "typescript"],
      ["logic-a.ts", "typescript"],
      ["logic-b.ts", "typescript"],
    ]);

    const { groups } = await findDuplicates(graph, root, { minLines: 4, windowSize: 8 });
    expect(groups.some((g) => g.occurrences.some((o) => o.file.startsWith("schema-")))).toBe(false);
    expect(groups.some((g) => g.occurrences.some((o) => o.file.startsWith("logic-")))).toBe(true);
  });

  describe("tokenCache", () => {
    const block = [
      "function computeTotal(items) {",
      "  let sum = 0;",
      "  for (let i = 0; i < items.length; i++) {",
      "    sum += items[i].price;",
      "  }",
      "  return sum;",
      "}",
    ].join("\n");

    test("a cache hit skips re-reading the file from disk", async () => {
      root = setup({ "a.ts": block, "b.ts": block });
      const graph = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const tokenCache = new Map();

      const first = await findDuplicates(graph, root, { minLines: 4, windowSize: 8, tokenCache });
      expect(first.groups.length).toBeGreaterThan(0);
      expect(tokenCache.size).toBe(2);

      // Both files vanish from disk, but the graph's mtime/size (still 0/0, unchanged) means the
      // cached tokens should be reused instead of re-reading — a stale read would silently drop
      // both files (the existing "missing file" handling) and report no duplicate at all.
      fs.rmSync(path.join(root, "a.ts"));
      fs.rmSync(path.join(root, "b.ts"));

      const second = await findDuplicates(graph, root, { minLines: 4, windowSize: 8, tokenCache });
      expect(second.groups.length).toBe(first.groups.length);
    });

    test("a size/mtime change invalidates the cached entry for that file", async () => {
      root = setup({ "a.ts": block, "b.ts": block });
      const graphV1 = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const tokenCache = new Map();

      const first = await findDuplicates(graphV1, root, {
        minLines: 4,
        windowSize: 8,
        tokenCache,
      });
      expect(first.groups.length).toBeGreaterThan(0);

      // Rewrite b.ts to no longer match, and bump its node's size so the cache treats it as
      // changed rather than reusing the stale (still-duplicated) cached tokens.
      const unrelated = "export const totallyDifferent = 42;\n// padding padding padding padding";
      fs.writeFileSync(path.join(root, "b.ts"), unrelated);
      const graphV2 = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const bNode = graphV2.nodes.get("b.ts");
      if (bNode) bNode.size = unrelated.length;

      const second = await findDuplicates(graphV2, root, {
        minLines: 4,
        windowSize: 8,
        tokenCache,
      });
      expect(second.groups.some((g) => g.occurrences.some((o) => o.file === "b.ts"))).toBe(false);
    });

    test("an ignoreLiterals change invalidates the cache even with an unchanged file", async () => {
      // A single differing literal token, nothing else — ignoreLiterals: true normalizes both to
      // the same "STR" placeholder (a match); ignoreLiterals: false compares the raw text (no
      // match). Isolating the whole file to just that one token means a stale ignoreLiterals:
      // true cache entry reused under ignoreLiterals: false would produce a false-positive match.
      root = setup({ "a.ts": '"hello"', "b.ts": '"goodbye"' });
      const graph = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const tokenCache = new Map();

      const withIgnored = await findDuplicates(graph, root, {
        minLines: 1,
        windowSize: 1,
        ignoreLiterals: true,
        tokenCache,
      });
      expect(withIgnored.groups.length).toBeGreaterThan(0);

      // Same files/mtimes, but ignoreLiterals: false must re-tokenize rather than reuse the
      // ignoreLiterals: true cache entry, since the literal text now matters.
      const withLiterals = await findDuplicates(graph, root, {
        minLines: 1,
        windowSize: 1,
        ignoreLiterals: false,
        tokenCache,
      });
      expect(withLiterals.groups).toHaveLength(0);
    });

    test("prunes cache entries for files no longer in the candidate set", async () => {
      root = setup({ "a.ts": block, "b.ts": block });
      const graph = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const tokenCache = new Map();
      await findDuplicates(graph, root, { minLines: 4, windowSize: 8, tokenCache });
      expect(tokenCache.size).toBe(2);

      const smallerGraph = graphFor([["a.ts", "typescript"]]);
      await findDuplicates(smallerGraph, root, { minLines: 4, windowSize: 8, tokenCache });
      expect([...tokenCache.keys()]).toEqual(["a.ts"]);
    });

    test("a cache round-tripped through disk still produces a cache hit", async () => {
      root = setup({ "a.ts": block, "b.ts": block });
      const graph = graphFor([
        ["a.ts", "typescript"],
        ["b.ts", "typescript"],
      ]);
      const tokenCache = new Map();
      await findDuplicates(graph, root, { minLines: 4, windowSize: 8, tokenCache });

      const cachePath = path.join(root, "duplication-tokens.json");
      saveTokenCacheToDisk(tokenCache, cachePath);
      const rehydrated = loadTokenCacheFromDisk(cachePath);
      expect(rehydrated.size).toBe(tokenCache.size);

      // Both files vanish from disk; only a genuine cache hit (not a re-read) can still find the
      // duplicate, proving the disk round trip preserves the cached tokens' fidelity.
      fs.rmSync(path.join(root, "a.ts"));
      fs.rmSync(path.join(root, "b.ts"));

      const result = await findDuplicates(graph, root, {
        minLines: 4,
        windowSize: 8,
        tokenCache: rehydrated,
      });
      expect(result.groups.length).toBeGreaterThan(0);
    });
  });
});
