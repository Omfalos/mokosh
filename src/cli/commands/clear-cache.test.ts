import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runClearCache } from "./clear-cache";

describe("runClearCache", { tags: ["runClearCache"] }, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-clear-cache-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes the cache file when present", () => {
    const cachePath = path.join(dir, "graph.json");
    fs.writeFileSync(cachePath, "{}");

    runClearCache(cachePath);

    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("is a no-op when the cache file does not exist", () => {
    const cachePath = path.join(dir, "graph.json");

    expect(() => runClearCache(cachePath)).not.toThrow();
    expect(fs.existsSync(cachePath)).toBe(false);
  });

  it("deletes the duplication token cache alongside the graph cache when present", () => {
    const cachePath = path.join(dir, "graph.json");
    const tokenCachePath = path.join(dir, "duplication-tokens.json");
    fs.writeFileSync(cachePath, "{}");
    fs.writeFileSync(tokenCachePath, "[]");

    runClearCache(cachePath);

    expect(fs.existsSync(cachePath)).toBe(false);
    expect(fs.existsSync(tokenCachePath)).toBe(false);
  });

  it("clears just the token cache without throwing when only it exists", () => {
    const cachePath = path.join(dir, "graph.json");
    const tokenCachePath = path.join(dir, "duplication-tokens.json");
    fs.writeFileSync(tokenCachePath, "[]");

    expect(() => runClearCache(cachePath)).not.toThrow();
    expect(fs.existsSync(tokenCachePath)).toBe(false);
  });

  it("recursively deletes the branch-graphs directory when present", () => {
    const cachePath = path.join(dir, "graph.json");
    const branchGraphDir = path.join(dir, "branch-graphs");
    fs.mkdirSync(branchGraphDir, { recursive: true });
    fs.writeFileSync(path.join(branchGraphDir, "abc123.json"), "{}");

    runClearCache(cachePath);

    expect(fs.existsSync(branchGraphDir)).toBe(false);
  });
});
