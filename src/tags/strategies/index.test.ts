import { describe, expect, test } from "vitest";
import { createStrategies, detectFrameworkFromImports, getStrategyForFile } from "./index";

describe("detectFrameworkFromImports", () => {
  test("detects playwright from @playwright/test import", () => {
    const source = 'import { test, expect } from "@playwright/test";\n';
    expect(detectFrameworkFromImports(source)).toBe("playwright");
  });

  test("detects cypress from cypress import", () => {
    const source = 'import "cypress";\n';
    expect(detectFrameworkFromImports(source)).toBe("cypress");
  });

  test("detects jest from @jest/globals import", () => {
    const source = 'import { describe, test } from "@jest/globals";\n';
    expect(detectFrameworkFromImports(source)).toBe("jest");
  });

  test("detects vitest from vitest import", () => {
    const source = 'import { describe, test } from "vitest";\n';
    expect(detectFrameworkFromImports(source)).toBe("vitest");
  });

  test("returns null when no framework import is present (globals mode)", () => {
    const source = 'test("does something", () => {});\n';
    expect(detectFrameworkFromImports(source)).toBeNull();
  });
});

describe("createStrategies auto-detection", () => {
  test("routes a mixed set of files to their own framework format in one call", () => {
    const strategies = createStrategies("vitest");

    const playwrightFile = "/repo/e2e/login.spec.ts";
    const playwrightSource = 'import { test } from "@playwright/test";\ntest("login", () => {});\n';
    const playwrightStrategy = getStrategyForFile(playwrightFile, strategies)!;
    const playwrightResult = playwrightStrategy.apply(playwrightFile, playwrightSource, ["auth"]);
    expect(playwrightResult).toContain('tag: ["@auth"]');

    const cypressFile = "/repo/cypress/e2e/login.cy.ts";
    const cypressSource = 'import "cypress";\ndescribe("login", () => {});\n';
    const cypressStrategy = getStrategyForFile(cypressFile, strategies)!;
    const cypressResult = cypressStrategy.apply(cypressFile, cypressSource, ["auth"]);
    expect(cypressResult).toContain('tags: ["@auth"]');

    const jestFile = "/repo/src/login.test.ts";
    const jestSource = 'import { test } from "@jest/globals";\ntest("login", () => {});\n';
    const jestStrategy = getStrategyForFile(jestFile, strategies)!;
    const jestResult = jestStrategy.apply(jestFile, jestSource, ["auth"]);
    expect(jestResult).toContain("@group auth");

    const globalsFile = "/repo/src/login.spec.ts";
    const globalsSource = 'test("login", () => {});\n';
    const globalsStrategy = getStrategyForFile(globalsFile, strategies)!;
    const globalsResult = globalsStrategy.apply(globalsFile, globalsSource, ["auth"]);
    expect(globalsResult).toContain('tags: ["auth"]');
  });

  test("falls back to the configured default framework when no import is detectable", () => {
    const strategies = createStrategies("playwright");
    const file = "/repo/src/login.spec.ts";
    const source = 'test("login", () => {});\n';
    const strategy = getStrategyForFile(file, strategies)!;
    const result = strategy.apply(file, source, ["auth"]);
    expect(result).toContain('tag: ["@auth"]');
  });

  test("uses the frameworkOverrides glob match when no import is detectable", () => {
    const strategies = createStrategies(
      "vitest",
      { "tests/e2e/**": "playwright", "tests/unit/**": "jest" },
      "/repo",
    );
    const source = 'test("login", () => {});\n';

    const e2eFile = "/repo/tests/e2e/login.spec.ts";
    const e2eStrategy = getStrategyForFile(e2eFile, strategies)!;
    expect(e2eStrategy.apply(e2eFile, source, ["auth"])).toContain('tag: ["@auth"]');

    const unitFile = "/repo/tests/unit/login.spec.ts";
    const unitStrategy = getStrategyForFile(unitFile, strategies)!;
    expect(unitStrategy.apply(unitFile, source, ["auth"])).toContain("@group auth");
  });

  test("detected import wins over a frameworkOverrides match for a different framework", () => {
    const strategies = createStrategies("vitest", { "tests/e2e/**": "playwright" }, "/repo");
    const source = 'import { describe, test } from "vitest";\ntest("login", () => {});\n';
    const file = "/repo/tests/e2e/login.spec.ts";
    const strategy = getStrategyForFile(file, strategies)!;
    expect(strategy.apply(file, source, ["auth"])).toContain('tags: ["auth"]');
  });

  test("falls back to the scalar default when no frameworkOverrides pattern matches", () => {
    const strategies = createStrategies("jest", { "tests/e2e/**": "playwright" }, "/repo");
    const source = 'test("login", () => {});\n';
    const file = "/repo/src/login.spec.ts";
    const strategy = getStrategyForFile(file, strategies)!;
    expect(strategy.apply(file, source, ["auth"])).toContain("@group auth");
  });
});
