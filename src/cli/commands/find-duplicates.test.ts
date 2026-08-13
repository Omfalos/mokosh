import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./find-duplicates";
import { makeContext } from "./test-context";

const BLOCK = [
  "function computeTotal(items) {",
  "  let sum = 0;",
  "  for (let i = 0; i < items.length; i++) {",
  "    sum += items[i].price;",
  "  }",
  "  return sum;",
  "}",
].join("\n");

function graphFor(root: string): Graph {
  const files: Array<["a.ts" | "b.ts", string]> = [
    ["a.ts", BLOCK],
    ["b.ts", BLOCK],
  ];
  const nodes = files.map(([rel, content]) => {
    fs.writeFileSync(path.join(root, rel), content);
    const stat = fs.statSync(path.join(root, rel));
    return {
      path: rel,
      type: "typescript" as const,
      category: "logic" as const,
      tags: [],
      imports: [],
      exports: [],
      mtime: stat.mtimeMs,
      size: stat.size,
    };
  });
  return Graph.deserialize({ nodes });
}

describe("find-duplicates command", { tags: ["find-duplicates", "cli"] }, () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-find-duplicates-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes the disk token cache next to the graph cache after a run", async () => {
    const cachePath = path.join(root, "mokosh-cache", "graph.json");
    const ctx = makeContext({
      graph: graphFor(root),
      rootDir: root,
      cachePath,
      minDuplicateLines: 4,
    });

    await run(ctx);

    const tokenCachePath = path.join(root, "mokosh-cache", "duplication-tokens.json");
    expect(fs.existsSync(tokenCachePath)).toBe(true);
    const persisted = JSON.parse(fs.readFileSync(tokenCachePath, "utf-8"));
    expect(persisted.map((e: [string, unknown]) => e[0]).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("reuses the disk token cache on a second run against unchanged files", async () => {
    const cachePath = path.join(root, "mokosh-cache", "graph.json");
    const graph = graphFor(root);
    const ctx = makeContext({ graph, rootDir: root, cachePath, minDuplicateLines: 4 });

    await run(ctx);

    // Both files vanish from disk; only a genuine cache hit (not a fresh read) can still find
    // the duplicate on the second run, since the graph's mtime/size are unchanged.
    fs.rmSync(path.join(root, "a.ts"));
    fs.rmSync(path.join(root, "b.ts"));

    logSpy.mockClear();
    await run(ctx);

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.groups.length).toBeGreaterThan(0);
  });
});
