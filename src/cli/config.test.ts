import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "./config";
import { DEFAULT_CACHE_DIR, DEFAULT_CACHE_FILE } from "./const";

describe("resolveConfig", { tags: ["resolveConfig"] }, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-config-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the computed default cache path when nothing overrides it", () => {
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: defaultCachePath,
      configPath: undefined,
    });

    expect(resolved.resolvedCachePath).toBe(defaultCachePath);
    expect(resolved.resolvedEntryPoints).toEqual([]);
    expect(resolved.rootDir).toBe(dir);
  });

  it("uses an explicit CLI --cache path over the default", () => {
    const explicitCachePath = path.join(dir, "custom-cache.json");
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: explicitCachePath,
      configPath: undefined,
    });

    expect(resolved.resolvedCachePath).toBe(explicitCachePath);
    expect(resolved.resolvedCachePath).not.toBe(defaultCachePath);
  });

  it("prefers explicit CLI entry points over mokosh.config's entryPoints", () => {
    fs.writeFileSync(
      path.join(dir, "mokosh.config.json"),
      JSON.stringify({ entryPoints: ["from-config.ts"] }),
    );
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: ["from-cli.ts"],
      cachePath: defaultCachePath,
      configPath: undefined,
    });

    expect(resolved.resolvedEntryPoints).toEqual(["from-cli.ts"]);
  });

  it("falls back to mokosh.config's entryPoints when the CLI gives none", () => {
    fs.writeFileSync(
      path.join(dir, "mokosh.config.json"),
      JSON.stringify({ entryPoints: ["from-config.ts"] }),
    );
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: defaultCachePath,
      configPath: undefined,
    });

    expect(resolved.resolvedEntryPoints).toEqual(["from-config.ts"]);
  });

  it("resolves a config-file cachePath relative to rootDir when the CLI cachePath is still the default", () => {
    fs.writeFileSync(
      path.join(dir, "mokosh.config.json"),
      JSON.stringify({ cachePath: "custom/graph.json" }),
    );
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: defaultCachePath,
      configPath: undefined,
    });

    expect(resolved.resolvedCachePath).toBe(path.resolve(dir, "custom/graph.json"));
  });

  it("derives scanOptions from mokosh.config's ignoreDirs/extensions", () => {
    fs.writeFileSync(
      path.join(dir, "mokosh.config.json"),
      JSON.stringify({ ignoreDirs: ["vendor"], extensions: [".foo"] }),
    );
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: defaultCachePath,
      configPath: undefined,
    });

    expect(resolved.scanOptions).toEqual({
      additionalIgnoreDirs: ["vendor"],
      additionalExtensions: [".foo"],
    });
  });

  it("loads config from an explicit --config path instead of rootDir", () => {
    const explicitConfigPath = path.join(dir, "custom.config.json");
    fs.writeFileSync(explicitConfigPath, JSON.stringify({ entryPoints: ["explicit.ts"] }));
    const defaultCachePath = path.join(path.resolve(dir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

    const resolved = resolveConfig({
      rootDir: dir,
      entryPoints: [],
      cachePath: defaultCachePath,
      configPath: explicitConfigPath,
    });

    expect(resolved.resolvedEntryPoints).toEqual(["explicit.ts"]);
  });
});
