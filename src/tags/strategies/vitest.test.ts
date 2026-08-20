import { describe, expect, test } from "vitest";
import { VitestStrategy } from "./vitest";

describe("VitestStrategy", () => {
  const strategy = new VitestStrategy();

  test("canHandle matches TS/JS extensions", () => {
    expect(strategy.canHandle("/repo/login.test.ts")).toBe(true);
    expect(strategy.canHandle("/repo/login.test.go")).toBe(false);
  });

  test("injects a tags array into describe with no options arg", () => {
    const source = 'describe("login", () => {});\n';
    const result = strategy.apply("/repo/login.test.ts", source, ["auth", "smoke"]);
    expect(result).toBe('describe("login", { tags: ["auth", "smoke"] }, () => {});\n');
  });

  test("updates an existing tags array in place", () => {
    const source = 'describe("login", { tags: ["old"] }, () => {});\n';
    const result = strategy.apply("/repo/login.test.ts", source, ["auth"]);
    expect(result).toBe('describe("login", { tags: ["auth"] }, () => {});\n');
  });

  test("is idempotent when tags already match", () => {
    const source = 'describe("login", { tags: ["auth", "smoke"] }, () => {});\n';
    const result = strategy.apply("/repo/login.test.ts", source, ["smoke", "auth"]);
    expect(result).toBe(source);
  });

  test("removes the tags property when tags is empty", () => {
    const source = 'describe("login", { tags: ["auth"] }, () => {});\n';
    const result = strategy.apply("/repo/login.test.ts", source, []);
    expect(result).toBe('describe("login", () => {});\n');
  });

  test("strips a legacy <mokosh-tags> comment block before applying", () => {
    const source =
      "// <mokosh-tags>\n// auth\n// </mokosh-tags>\n" + 'describe("login", () => {});\n';
    const result = strategy.apply("/repo/login.test.ts", source, ["auth"]);
    expect(result).toBe('describe("login", { tags: ["auth"] }, () => {});\n');
  });

  test("returns source unchanged when no top-level calls are found", () => {
    const source = "const x = 1;\n";
    const result = strategy.apply("/repo/login.test.ts", source, ["auth"]);
    expect(result).toBe(source);
  });
});
