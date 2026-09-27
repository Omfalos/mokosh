import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CoverageResultParams,
  coverageResultCacheKey,
  loadCoverageResult,
  saveCoverageResult,
} from "./result-cache-store";

const PARAMS: CoverageResultParams = { timeoutMs: 60000, packages: ["b", "a"] };

describe("coverageResultCacheKey", () => {
  it("is stable regardless of packages array order", () => {
    const k1 = coverageResultCacheKey({ timeoutMs: 60000, packages: ["a", "b"] });
    const k2 = coverageResultCacheKey({ timeoutMs: 60000, packages: ["b", "a"] });
    expect(k1).toBe(k2);
  });

  it("differs when timeoutMs or packages change", () => {
    const base = coverageResultCacheKey(PARAMS);
    expect(coverageResultCacheKey({ ...PARAMS, timeoutMs: 1000 })).not.toBe(base);
    expect(coverageResultCacheKey({ ...PARAMS, packages: ["a"] })).not.toBe(base);
  });

  it("treats undefined packages distinctly from an explicit list", () => {
    expect(coverageResultCacheKey({ timeoutMs: 1, packages: undefined })).not.toBe(
      coverageResultCacheKey({ timeoutMs: 1, packages: [] }),
    );
  });
});

describe("saveCoverageResult / loadCoverageResult", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-coverage-cache-test-"));
    cachePath = path.join(dir, "nested", "coverage-result.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a saved map on a matching digest and params key", () => {
    const map = new Map([
      ["src/a.ts", 90],
      ["src/b.ts", 40],
    ]);
    saveCoverageResult(cachePath, "digest1", "params1", map);
    const loaded = loadCoverageResult(cachePath, "digest1", "params1");
    expect(loaded).toEqual(map);
  });

  it("misses on a digest mismatch", () => {
    saveCoverageResult(cachePath, "digest1", "params1", new Map([["a.ts", 50]]));
    expect(loadCoverageResult(cachePath, "digest2", "params1")).toBeNull();
  });

  it("misses on a params key mismatch", () => {
    saveCoverageResult(cachePath, "digest1", "params1", new Map([["a.ts", 50]]));
    expect(loadCoverageResult(cachePath, "digest1", "params2")).toBeNull();
  });

  it("misses (never throws) on a missing file", () => {
    expect(loadCoverageResult(path.join(dir, "nope.json"), "d", "p")).toBeNull();
  });

  it("misses (never throws) on corrupt JSON", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{not json");
    expect(loadCoverageResult(cachePath, "d", "p")).toBeNull();
  });

  it("misses on a wrong-shaped file", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ digest: "d", paramsKey: "p" }));
    expect(loadCoverageResult(cachePath, "d", "p")).toBeNull();
  });

  it("creates parent directories on save", () => {
    expect(fs.existsSync(path.dirname(cachePath))).toBe(false);
    saveCoverageResult(cachePath, "d", "p", new Map());
    expect(fs.existsSync(cachePath)).toBe(true);
  });
});
