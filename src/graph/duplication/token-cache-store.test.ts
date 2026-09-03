import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CachedFileTokens,
  type DuplicationTokenCache,
  loadTokenCacheFromDisk,
  saveTokenCacheToDisk,
} from "./token-cache-store";

function entry(overrides: Partial<CachedFileTokens> = {}): CachedFileTokens {
  return {
    mtime: 1000,
    size: 42,
    ignoreLiterals: true,
    generated: false,
    tokens: [{ text: "foo", line: 1 }],
    ...overrides,
  };
}

describe("token-cache-store", { tags: ["token-cache-store", "duplication"] }, () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-token-cache-"));
    cachePath = path.join(dir, "nested", "duplication-tokens.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty Map when the file does not exist", () => {
    const cache = loadTokenCacheFromDisk(cachePath);
    expect(cache.size).toBe(0);
  });

  it("round-trips a multi-entry cache through save then load", () => {
    const cache: DuplicationTokenCache = new Map([
      ["a.ts", entry()],
      ["b.ts", entry({ mtime: 2000, size: 7, ignoreLiterals: false, tokens: [] })],
    ]);

    saveTokenCacheToDisk(cache, cachePath);
    const loaded = loadTokenCacheFromDisk(cachePath);

    expect(loaded).toEqual(cache);
  });

  it("creates missing parent directories on save", () => {
    expect(fs.existsSync(path.dirname(cachePath))).toBe(false);

    saveTokenCacheToDisk(new Map([["a.ts", entry()]]), cachePath);

    expect(fs.existsSync(cachePath)).toBe(true);
  });

  it("returns an empty Map instead of throwing on invalid JSON", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{not valid json");

    expect(() => loadTokenCacheFromDisk(cachePath)).not.toThrow();
    expect(loadTokenCacheFromDisk(cachePath).size).toBe(0);
  });

  it("returns an empty Map instead of throwing on well-formed but wrong-shaped JSON", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    // Looks like a plausible cache file (an object, not an array) but isn't the expected
    // [path, CachedFileTokens][] shape — e.g. someone pointed this at graph.json by mistake.
    fs.writeFileSync(cachePath, JSON.stringify({ nodes: [] }));

    expect(loadTokenCacheFromDisk(cachePath).size).toBe(0);
  });

  it("drops individual entries that don't match the CachedFileTokens shape", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify([
        ["a.ts", entry()],
        ["b.ts", { mtime: "not-a-number", size: 7, ignoreLiterals: true, tokens: [] }],
        ["c.ts", null],
        "not-a-tuple",
      ]),
    );

    const loaded = loadTokenCacheFromDisk(cachePath);
    expect([...loaded.keys()]).toEqual(["a.ts"]);
  });
});
