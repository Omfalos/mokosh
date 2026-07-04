import { describe, expect, test } from "vitest";
import { JestStrategy } from "./jest";

describe("JestStrategy", () => {
  const strategy = new JestStrategy();

  test("canHandle matches TS/JS extensions", () => {
    expect(strategy.canHandle("/repo/auth.test.ts")).toBe(true);
    expect(strategy.canHandle("/repo/auth.test.js")).toBe(true);
    expect(strategy.canHandle("/repo/auth.test.py")).toBe(false);
  });

  test("injects a @group docblock above existing content", () => {
    const source = 'import { test } from "@jest/globals";\ntest("logs in", () => {});\n';
    const result = strategy.apply("/repo/auth.test.ts", source, ["auth", "smoke"]);
    expect(result).toBe(
      "/**\n * @group auth\n * @group smoke\n */\n\n" +
        'import { test } from "@jest/globals";\ntest("logs in", () => {});\n',
    );
  });

  test("updates an existing @group docblock in place", () => {
    const source =
      "/**\n * @group old\n */\n\n" +
      'import { test } from "@jest/globals";\ntest("logs in", () => {});\n';
    const result = strategy.apply("/repo/auth.test.ts", source, ["auth"]);
    expect(result).toBe(
      "/**\n * @group auth\n */\n\n" +
        'import { test } from "@jest/globals";\ntest("logs in", () => {});\n',
    );
  });

  test("is idempotent when tags already match", () => {
    const source =
      "/**\n * @group auth\n * @group smoke\n */\n\n" +
      'import { test } from "@jest/globals";\ntest("logs in", () => {});\n';
    const result = strategy.apply("/repo/auth.test.ts", source, ["auth", "smoke"]);
    expect(result).toBe(source);
  });

  test("removes the docblock when tags is empty", () => {
    const source =
      "/**\n * @group auth\n */\n\n" +
      'import { test } from "@jest/globals";\ntest("logs in", () => {});\n';
    const result = strategy.apply("/repo/auth.test.ts", source, []);
    expect(result).toBe('import { test } from "@jest/globals";\ntest("logs in", () => {});\n');
  });
});
