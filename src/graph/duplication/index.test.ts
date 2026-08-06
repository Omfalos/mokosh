import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { FileType } from "../../types/parse";
import { Graph } from "../model";
import { findDuplicates } from "./index";

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

    const groups = await findDuplicates(graph, root, { minLines: 4, windowSize: 8 });
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

    const groups = await findDuplicates(graph, root, { minLines: 3, windowSize: 6 });
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
    expect(tooStrict).toHaveLength(0);

    const limited = await findDuplicates(graph, root, { minLines: 2, limit: 1 });
    expect(limited.length).toBeLessThanOrEqual(1);
  });

  test("skips files listed in the graph but missing on disk instead of throwing", async () => {
    root = setup({ "a.ts": "const a = 1;" });
    const graph = graphFor([
      ["a.ts", "typescript"],
      ["missing.ts", "typescript"],
    ]);

    await expect(findDuplicates(graph, root)).resolves.toEqual([]);
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

    await expect(findDuplicates(graph, root, { minLines: 3 })).resolves.toEqual([]);
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

    await expect(findDuplicates(graph, root, { minLines: 3 })).resolves.toEqual([]);
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
    expect(withDefaults.length).toBeGreaterThan(0);

    // ...but an explicit ignoreDirs excludes it.
    const withCustom = await findDuplicates(graph, root, { minLines: 3, ignoreDirs: ["vendor"] });
    expect(withCustom).toEqual([]);
  });
});
