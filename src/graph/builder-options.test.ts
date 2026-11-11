import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GraphBuilder } from "./builder";

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-builder-opts-")));
  fs.writeFileSync(path.join(root, "a.js"), "export const a = 1;");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("GraphBuilderOptions", () => {
  test("loadGitStats is the git seam: stats come from the injected source, not from git", async () => {
    const loadGitStats = vi.fn(
      () => new Map([["a.js", { commitCount90d: 7, lastAuthor: "Ada", lastCommitAt: 1 }]]),
    );
    const graph = await new GraphBuilder(root, {
      gitStats: true,
      loadGitStats,
      parallelParsing: false,
    }).build(["a.js"]);
    expect(loadGitStats).toHaveBeenCalledWith(root);
    expect(graph.nodes.get("a.js")).toMatchObject({ commitCount90d: 7, lastAuthor: "Ada" });
  });

  test("loadGitStats is never called when gitStats is off", async () => {
    const loadGitStats = vi.fn(() => new Map());
    await new GraphBuilder(root, { loadGitStats, parallelParsing: false }).build(["a.js"]);
    expect(loadGitStats).not.toHaveBeenCalled();
  });

  test("an injected resolver replaces the default one", async () => {
    fs.writeFileSync(path.join(root, "b.js"), "import './a.js';");
    const resolveAll = vi.fn(() => [{ path: path.join(root, "a.js"), isExternal: false }]);
    const resolver = { resolveAll } as never;
    const graph = await new GraphBuilder(root, { resolver, parallelParsing: false }).build([
      "b.js",
    ]);
    expect(resolveAll).toHaveBeenCalledWith(path.join(root, "b.js"), "./a.js");
    expect(graph.nodes.get("b.js")?.imports[0]?.toPath).toBe("a.js");
  });

  test("every option is optional", async () => {
    const graph = await new GraphBuilder(root).build(["a.js"]);
    expect(graph.nodes.has("a.js")).toBe(true);
  });
});
