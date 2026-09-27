import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrRunCoverage } from "./get-or-run";

const { runAutoCoverageMock } = vi.hoisted(() => ({
  runAutoCoverageMock: vi.fn(async () => new Map([["a.ts", 77]])),
}));

vi.mock("./run-coverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-coverage")>();
  return { ...actual, runAutoCoverage: runAutoCoverageMock };
});

describe("getOrRunCoverage", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-coverage-getorrun-"));
    runAutoCoverageMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const nodes = [{ path: "a.ts", mtime: 1, size: 10 }];

  it("runs coverage on a cache miss and persists the result", async () => {
    const map = await getOrRunCoverage("/repo", nodes, undefined, {}, cacheDir);
    expect(map.get("a.ts")).toBe(77);
    expect(runAutoCoverageMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(cacheDir, "coverage-result.json"))).toBe(true);
  });

  it("reuses the cached result when the node digest and params are unchanged", async () => {
    await getOrRunCoverage("/repo", nodes, undefined, {}, cacheDir);
    const map = await getOrRunCoverage("/repo", nodes, undefined, {}, cacheDir);
    expect(map.get("a.ts")).toBe(77);
    expect(runAutoCoverageMock).toHaveBeenCalledTimes(1);
  });

  it("reruns when a node's mtime changes", async () => {
    await getOrRunCoverage("/repo", nodes, undefined, {}, cacheDir);
    await getOrRunCoverage(
      "/repo",
      [{ path: "a.ts", mtime: 2, size: 10 }],
      undefined,
      {},
      cacheDir,
    );
    expect(runAutoCoverageMock).toHaveBeenCalledTimes(2);
  });

  it("reruns when timeoutMs changes", async () => {
    await getOrRunCoverage("/repo", nodes, undefined, { timeoutMs: 1000 }, cacheDir);
    await getOrRunCoverage("/repo", nodes, undefined, { timeoutMs: 2000 }, cacheDir);
    expect(runAutoCoverageMock).toHaveBeenCalledTimes(2);
  });
});
