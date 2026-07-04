/**
 * Strategy registry.
 *
 * Two categories of strategy:
 *   Language strategies  — auto-selected by file extension, always active regardless of config:
 *                          Gherkin (.feature), Pytest (.py), Go (*_test.go)
 *   Framework strategies — selected by `tagApplier.framework` in mokosh.config.*, applied to
 *                          TS/JS files where multiple frameworks are common: Vitest, Playwright,
 *                          Cypress.
 *
 * Lookup order: language strategies checked first (narrow extension predicates), framework
 * strategy checked last for any TS/JS file the language strategies don't claim.
 */

import { CypressStrategy } from "./cypress";
import { GherkinStrategy } from "./gherkin";
import { GoStrategy } from "./go";
import { PlaywrightStrategy } from "./playwright";
import { PytestStrategy } from "./pytest";
import type { TagApplierStrategy, TagFramework } from "./types";
import { VitestStrategy } from "./vitest";

export type { TagApplierStrategy, TagFramework };

const FRAMEWORK_STRATEGIES: Record<TagFramework, () => TagApplierStrategy> = {
  vitest: () => new VitestStrategy(),
  playwright: () => new PlaywrightStrategy(),
  cypress: () => new CypressStrategy(),
};

/**
 * @description Returns the ordered list of strategies to use for tag annotation.
 *   Language strategies (Gherkin, Pytest, Go) are always included and checked first.
 *   The framework strategy is appended last and handles TS/JS files.
 * @param {TagFramework} framework - The configured TS/JS test framework. Defaults to `"vitest"`.
 * @returns {TagApplierStrategy[]} Strategies in priority order.
 */
export function createStrategies(framework: TagFramework = "vitest"): TagApplierStrategy[] {
  const frameworkStrategy = FRAMEWORK_STRATEGIES[framework]?.() ?? new VitestStrategy();
  return [
    new GherkinStrategy(), // .feature
    new PytestStrategy(), // .py
    new GoStrategy(), // *_test.go
    frameworkStrategy, // TS/JS
  ];
}

/**
 * @description Finds the first strategy in the list that declares it can handle the file.
 * @param {string} absPath - Absolute file path.
 * @param {TagApplierStrategy[]} strategies - Ordered candidate strategies.
 * @returns {TagApplierStrategy | null} The matched strategy, or null if none applies.
 */
export function getStrategyForFile(
  absPath: string,
  strategies: TagApplierStrategy[],
): TagApplierStrategy | null {
  return strategies.find((s) => s.canHandle(absPath)) ?? null;
}
