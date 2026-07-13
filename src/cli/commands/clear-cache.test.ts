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
});
