import { describe, expect, test } from "vitest";
import { PlaywrightStrategy } from "./playwright";

describe("PlaywrightStrategy", () => {
  const strategy = new PlaywrightStrategy();

  test("canHandle matches TS/JS extensions", () => {
    expect(strategy.canHandle("/repo/login.spec.ts")).toBe(true);
    expect(strategy.canHandle("/repo/login.spec.py")).toBe(false);
  });

  test("injects a singular @-prefixed tag array into test()", () => {
    const source = 'test("logs in", () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, ["auth"]);
    expect(result).toBe('test("logs in", { tag: ["@auth"] }, () => {});\n');
  });

  test("handles test.describe property-access form", () => {
    const source = 'test.describe("suite", () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, ["auth"]);
    expect(result).toBe('test.describe("suite", { tag: ["@auth"] }, () => {});\n');
  });

  test("updates an existing tag array in place", () => {
    const source = 'test("logs in", { tag: ["@old"] }, () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, ["auth", "smoke"]);
    expect(result).toBe('test("logs in", { tag: ["@auth", "@smoke"] }, () => {});\n');
  });

  test("is idempotent when tags already match", () => {
    const source = 'test("logs in", { tag: ["@auth"] }, () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, ["auth"]);
    expect(result).toBe(source);
  });

  test("appends tag alongside an existing unrelated option", () => {
    const source = 'test("logs in", { timeout: 5000 }, () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, ["auth"]);
    expect(result).toBe('test("logs in", { timeout: 5000 , tag: ["@auth"]}, () => {});\n');
  });

  test("removes the tag property when tags is empty", () => {
    const source = 'test("logs in", { tag: ["@auth"] }, () => {});\n';
    const result = strategy.apply("/repo/login.spec.ts", source, []);
    expect(result).toBe('test("logs in", () => {});\n');
  });
});
