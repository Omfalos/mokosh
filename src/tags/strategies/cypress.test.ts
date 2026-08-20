import { describe, expect, test } from "vitest";
import { CypressStrategy } from "./cypress";

describe("CypressStrategy", () => {
  const strategy = new CypressStrategy();

  test("canHandle matches TS/JS extensions, not other files", () => {
    expect(strategy.canHandle("/repo/login.cy.ts")).toBe(true);
    expect(strategy.canHandle("/repo/login.cy.js")).toBe(true);
    expect(strategy.canHandle("/repo/login.feature")).toBe(false);
  });

  test("injects an @-prefixed tags array into describe with no options arg", () => {
    const source = 'describe("login", () => {});\n';
    const result = strategy.apply("/repo/login.cy.ts", source, ["auth", "smoke"]);
    expect(result).toBe('describe("login", { tags: ["@auth", "@smoke"] }, () => {});\n');
  });

  test("updates an existing tags array in place", () => {
    const source = 'describe("login", { tags: ["@old"] }, () => {});\n';
    const result = strategy.apply("/repo/login.cy.ts", source, ["auth"]);
    expect(result).toBe('describe("login", { tags: ["@auth"] }, () => {});\n');
  });

  test("is idempotent when tags already match, ignoring @ prefix", () => {
    const source = 'describe("login", { tags: ["@auth", "@smoke"] }, () => {});\n';
    const result = strategy.apply("/repo/login.cy.ts", source, ["smoke", "auth"]);
    expect(result).toBe(source);
  });

  test("removes the tags property when tags is empty", () => {
    const source = 'describe("login", { tags: ["@auth"] }, () => {});\n';
    const result = strategy.apply("/repo/login.cy.ts", source, []);
    expect(result).toBe('describe("login", () => {});\n');
  });

  test("returns source unchanged when no describe/it/context call is found", () => {
    const source = "const x = 1;\nconsole.log(x);\n";
    const result = strategy.apply("/repo/login.cy.ts", source, ["auth"]);
    expect(result).toBe(source);
  });

  test("annotates every top-level call, not just the first", () => {
    const source = 'describe("a", () => {});\nit("b", () => {});\n';
    const result = strategy.apply("/repo/login.cy.ts", source, ["auth"]);
    expect(result).toBe(
      'describe("a", { tags: ["@auth"] }, () => {});\nit("b", { tags: ["@auth"] }, () => {});\n',
    );
  });
});
