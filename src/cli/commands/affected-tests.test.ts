import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./affected-tests";
import { makeContext, makeFixtureGraph } from "./test-context";

const { getChangedFilesMock } = vi.hoisted(() => ({
  getChangedFilesMock: vi.fn((): string[] => []),
}));
vi.mock("../../git", () => ({
  DefaultGitProvider: class {
    getChangedFiles = getChangedFilesMock;
  },
}));

describe("affected-tests command", { tags: ["affected-tests"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getChangedFilesMock.mockReset().mockReturnValue([]);
  });

  it("prints nothing when the graph already has test nodes and nothing changed", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    // makeFixtureGraph's nodes aren't test files, so the command still re-scans; point rootDir
    // at a throwaway empty directory so that scan finds nothing rather than touching real files.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-affected-tests-"));
    try {
      await run(makeContext({ graph: makeFixtureGraph(), rootDir: dir }));

      expect(logSpy).toHaveBeenCalledWith("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes --base through to the git provider", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-affected-tests-"));
    try {
      await run(makeContext({ graph: makeFixtureGraph(), rootDir: dir, base: "origin/main" }));

      expect(getChangedFilesMock).toHaveBeenCalledWith(dir, "origin/main");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips the rescan when the graph already contains test nodes", async () => {
    const graph = makeFixtureGraph();
    // Mutate one node's path in-place to look like a test file so the `hasTestNodes` check
    // short-circuits — the rootDir below has no files at all, so any rescan would find nothing.
    const nodeA = graph.nodes.get("src/a.ts");
    if (nodeA) graph.nodes.set("src/a.test.ts", { ...nodeA, path: "src/a.test.ts" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-affected-tests-empty-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      await run(makeContext({ graph, rootDir: dir }));

      expect(logSpy).toHaveBeenCalledWith("");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
