import { describe, expect, test } from "vitest";
import { matchesGlob } from "./glob";

describe("matchesGlob", () => {
  test("** matches nested paths under a directory prefix", () => {
    expect(matchesGlob("tests/e2e/**", "tests/e2e/login.spec.ts")).toBe(true);
    expect(matchesGlob("tests/e2e/**", "tests/e2e/nested/deep/login.spec.ts")).toBe(true);
  });

  test("** does not match a sibling directory", () => {
    expect(matchesGlob("tests/e2e/**", "tests/unit/login.spec.ts")).toBe(false);
  });

  test("single * does not cross a path separator", () => {
    expect(matchesGlob("tests/e2e/*.spec.ts", "tests/e2e/login.spec.ts")).toBe(true);
    expect(matchesGlob("tests/e2e/*.spec.ts", "tests/e2e/nested/login.spec.ts")).toBe(false);
  });

  test("? matches exactly one non-separator character", () => {
    expect(matchesGlob("tests/e2e/login?.spec.ts", "tests/e2e/login1.spec.ts")).toBe(true);
    expect(matchesGlob("tests/e2e/login?.spec.ts", "tests/e2e/login12.spec.ts")).toBe(false);
  });

  test("returns false for an unmatched pattern", () => {
    expect(matchesGlob("tests/e2e/**", "src/login.spec.ts")).toBe(false);
  });

  test("root-relative pattern matches from the project root", () => {
    expect(matchesGlob("*.config.ts", "vitest.config.ts")).toBe(true);
    expect(matchesGlob("*.config.ts", "src/vitest.config.ts")).toBe(false);
  });

  test("normalizes backslash separators before matching", () => {
    expect(matchesGlob("tests/e2e/**", "tests\\e2e\\login.spec.ts")).toBe(true);
  });
});
