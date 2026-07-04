import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgs } from "./args";

const cwd = process.cwd();

describe("parseArgs", { tags: ["args", "parseArgs"] }, () => {
  it("returns help:true when no args given", () => {
    expect(parseArgs([]).help).toBe(true);
  });

  it("returns help:true for --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  it("returns help:false for normal args", () => {
    expect(parseArgs(["src/index.ts"]).help).toBe(false);
  });

  it("parses --root and resolves it", () => {
    const result = parseArgs(["--root", "/tmp/project"]);
    expect(result.rootDir).toBe("/tmp/project");
  });

  it("defaults rootDir to cwd", () => {
    expect(parseArgs(["src/index.ts"]).rootDir).toBe(cwd);
  });

  it("parses --cache with explicit path", () => {
    const result = parseArgs(["--cache", "custom/cache.json", "src/index.ts"]);
    expect(result.cachePath).toBe(path.resolve(cwd, "custom/cache.json"));
  });

  it("uses default cache path when --cache has no value", () => {
    const result = parseArgs(["--cache", "--mermaid"]);
    expect(result.cachePath).toBe(path.join(cwd, "mokosh-cache", "graph.json"));
  });

  it("uses default cache path when --cache is absent", () => {
    const result = parseArgs(["src/index.ts"]);
    expect(result.cachePath).toBe(path.join(cwd, "mokosh-cache", "graph.json"));
  });

  it("default cache path is relative to --root when root is provided", () => {
    const result = parseArgs(["--root", "/tmp/project"]);
    expect(result.cachePath).toBe("/tmp/project/mokosh-cache/graph.json");
  });

  it("parses --mermaid", () => {
    expect(parseArgs(["--mermaid", "src/index.ts"]).mermaid).toBe(true);
  });

  it("parses --propose-tags", () => {
    expect(parseArgs(["--propose-tags"]).proposeTags).toBe(true);
  });

  it("parses --affected-tests", () => {
    expect(parseArgs(["--affected-tests"]).affectedTests).toBe(true);
  });

  it("parses --detect-features", () => {
    expect(parseArgs(["--detect-features"]).detectFeatures).toBe(true);
  });

  it("parses --feature-threshold as integer", () => {
    expect(parseArgs(["--feature-threshold", "10"]).featureThreshold).toBe(10);
  });

  it("parses --find-unused", () => {
    expect(parseArgs(["--find-unused"]).findUnused).toBe(true);
  });

  it("parses --query", () => {
    expect(parseArgs(["--query", "category:logic"]).query).toBe("category:logic");
  });

  it("collects positional args as entryPoints", () => {
    const result = parseArgs(["src/a.ts", "src/b.ts"]);
    expect(result.entryPoints).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("ignores unknown flags", () => {
    const result = parseArgs(["--unknown-flag", "src/index.ts"]);
    expect(result.entryPoints).toEqual(["src/index.ts"]);
    expect(result.help).toBe(false);
  });

  it("skips --root value from entryPoints", () => {
    const result = parseArgs(["--root", "/tmp", "src/index.ts"]);
    expect(result.entryPoints).toEqual(["src/index.ts"]);
  });
});
