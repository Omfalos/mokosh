import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { applyConfig, loadMokoshConfig } from "./config";
import { parseFile } from "./parser";
import { getBarrelThreshold, getTestLibraries, getTestPatterns } from "./parser/classify";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── loadMokoshConfig ─────────────────────────────────────────────────────────

describe("loadMokoshConfig", {
  tags: [
    "applyConfig",
    "classify",
    "config",
    "getBarrelThreshold",
    "getTestLibraries",
    "getTestPatterns",
    "loadMokoshConfig",
    "parseFile",
    "parser",
  ],
}, () => {
  test("returns empty object when no config file exists", () => {
    expect(loadMokoshConfig(tmpDir)).toEqual({});
  });

  test("loads mokosh.config.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mokosh.config.json"),
      JSON.stringify({ barrelThreshold: 0.6, cachePath: "my-cache/graph.json" }),
    );
    const config = loadMokoshConfig(tmpDir);
    expect(config.barrelThreshold).toBe(0.6);
    expect(config.cachePath).toBe("my-cache/graph.json");
  });

  test("loads mokosh.config.js with plain object export", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mokosh.config.js"),
      `module.exports = { barrelThreshold: 0.75, entryPoints: ["src/main.ts"] };`,
    );
    const config = loadMokoshConfig(tmpDir);
    expect(config.barrelThreshold).toBe(0.75);
    expect(config.entryPoints).toEqual(["src/main.ts"]);
  });

  test("loads mokosh.config.js with factory function export", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mokosh.config.js"),
      `module.exports = (defaults) => ({ ...defaults, barrelThreshold: 0.55 });`,
    );
    const config = loadMokoshConfig(tmpDir);
    expect(config.barrelThreshold).toBe(0.55);
  });

  test("prefers mokosh.config.js over mokosh.config.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "mokosh.config.js"),
      `module.exports = { barrelThreshold: 0.1 };`,
    );
    fs.writeFileSync(
      path.join(tmpDir, "mokosh.config.json"),
      JSON.stringify({ barrelThreshold: 0.9 }),
    );
    const config = loadMokoshConfig(tmpDir);
    expect(config.barrelThreshold).toBe(0.1);
  });

  test("loads all supported fields from JSON", () => {
    const full = {
      ignoreDirs: ["vendor"],
      extensions: [".graphql"],
      cachePath: "out/graph.json",
      entryPoints: ["src/a.ts"],
      configMatchers: [".myconfig."],
      testPatterns: [".unit."],
      testLibraries: ["@acme/test"],
      barrelThreshold: 0.65,
    };
    fs.writeFileSync(path.join(tmpDir, "mokosh.config.json"), JSON.stringify(full));
    expect(loadMokoshConfig(tmpDir)).toEqual(full);
  });
});

// ─── applyConfig ──────────────────────────────────────────────────────────────

describe("applyConfig", {
  tags: [
    "applyConfig",
    "classify",
    "config",
    "getBarrelThreshold",
    "getTestLibraries",
    "getTestPatterns",
    "loadMokoshConfig",
    "parseFile",
    "parser",
  ],
}, () => {
  test("does not throw on empty config", () => {
    expect(() => applyConfig({})).not.toThrow();
  });

  test("registers custom test patterns", () => {
    const unique = `.xunit-${Date.now()}.`;
    applyConfig({ testPatterns: [unique] });
    expect(getTestPatterns()).toContain(unique);
  });

  test("registers custom test libraries", () => {
    const unique = `@acme/test-utils-${Date.now()}`;
    applyConfig({ testLibraries: [unique] });
    expect(getTestLibraries()).toContain(unique);
  });

  test("sets barrel threshold", () => {
    applyConfig({ barrelThreshold: 0.42 });
    expect(getBarrelThreshold()).toBe(0.42);
  });

  test("registers multiple values in one call", () => {
    const p1 = `.alpha-${Date.now()}.`;
    const p2 = `.beta-${Date.now()}.`;
    applyConfig({ testPatterns: [p1, p2] });
    const patterns = getTestPatterns();
    expect(patterns).toContain(p1);
    expect(patterns).toContain(p2);
  });
});

// ─── Integration: applyConfig + parseFile ────────────────────────────────────

describe("applyConfig integration with parseFile", {
  tags: [
    "applyConfig",
    "classify",
    "config",
    "getBarrelThreshold",
    "getTestLibraries",
    "getTestPatterns",
    "loadMokoshConfig",
    "parseFile",
    "parser",
  ],
}, () => {
  test("custom testPattern causes file to be categorised as test", async () => {
    const unique = `.xspec-${Date.now()}.`;
    applyConfig({ testPatterns: [unique] });
    const result = await parseFile(`login${unique}ts`, `export const x = 1;`);
    expect(result.category).toBe("test");
  });

  test("custom testLibrary causes file to be categorised as test", async () => {
    const unique = `@acme/assert-${Date.now()}`;
    applyConfig({ testLibraries: [unique] });
    const result = await parseFile("util.ts", `import { assert } from '${unique}';`);
    expect(result.category).toBe("test");
  });

  test("custom configMatcher causes file to be categorised as config", async () => {
    applyConfig({ configMatchers: [".infraconfig."] });
    const result = await parseFile("app.infraconfig.ts", `export const x = 1;`);
    expect(result.category).toBe("config");
  });

  test("barrelThreshold affects barrel classification", async () => {
    // 2 of 3 statements are exports = 66%
    const content = `
      export const a = 1;
      export const b = 2;
      const c = 3;
    `;
    // With default threshold 0.8: should NOT be a barrel (66% < 80%)
    // applyConfig was called above and may have changed threshold; use a known value
    applyConfig({ barrelThreshold: 0.5 });
    const result = await parseFile("index.ts", content);
    expect(result.category).toBe("barrel");
  });
});
