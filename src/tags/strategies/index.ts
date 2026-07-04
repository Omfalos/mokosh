/**
 * Strategy registry.
 *
 * Two categories of strategy:
 *   Language strategies  — auto-selected by file extension, always active regardless of config:
 *                          Gherkin (.feature), Pytest (.py), Go (*_test.go)
 *   Framework strategies — selected per file by import-specifier detection for TS/JS files
 *                          where multiple frameworks are common: Vitest, Playwright, Cypress,
 *                          Jest. A repo mixing frameworks (e.g. Jest for unit tests, Playwright
 *                          for e2e) gets each file tagged in its own framework's native format.
 *
 * Lookup order: language strategies checked first (narrow extension predicates), the
 * auto-detecting framework strategy checked last for any TS/JS file the language strategies
 * don't claim.
 */

import path from "node:path";
import ts from "typescript";
import { CypressStrategy } from "./cypress";
import { GherkinStrategy } from "./gherkin";
import { matchesGlob } from "./glob";
import { GoStrategy } from "./go";
import { JestStrategy } from "./jest";
import { PlaywrightStrategy } from "./playwright";
import { PytestStrategy } from "./pytest";
import { TS_EXTENSIONS } from "./ts-ast-utils";
import type { TagApplierStrategy, TagFramework } from "./types";
import { VitestStrategy } from "./vitest";

export type { TagApplierStrategy, TagFramework };

const FRAMEWORK_STRATEGIES: Record<TagFramework, () => TagApplierStrategy> = {
  vitest: () => new VitestStrategy(),
  playwright: () => new PlaywrightStrategy(),
  cypress: () => new CypressStrategy(),
  jest: () => new JestStrategy(),
};

// Import specifiers that unambiguously identify which test framework a file uses.
const FRAMEWORK_IMPORT_MARKERS: Record<string, TagFramework> = {
  "@playwright/test": "playwright",
  cypress: "cypress",
  "@jest/globals": "jest",
  vitest: "vitest",
};

/**
 * @description Inspects a TS/JS file's top-level import declarations and returns the test
 *   framework they identify, or null when no known framework import is present (e.g. a file
 *   relying on Vitest/Jest `globals: true` with no explicit import).
 * @param {string} source - File source text.
 * @returns {TagFramework | null} The detected framework, or null if undetermined.
 */
export function detectFrameworkFromImports(source: string): TagFramework | null {
  const sf = ts.createSourceFile("detect.ts", source, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const framework = FRAMEWORK_IMPORT_MARKERS[stmt.moduleSpecifier.text];
    if (framework) return framework;
  }
  return null;
}

/**
 * @description Composite strategy for TS/JS files: detects the test framework from each file's
 *   own imports and delegates to that framework's strategy. When detection is inconclusive
 *   (e.g. `globals: true` with no explicit import), falls back to the first `frameworkOverrides`
 *   glob pattern (checked in config order) that matches the file's project-relative path, then
 *   to the scalar `defaultFramework`. This lets a single repo mix Jest/Vitest/Playwright/Cypress
 *   test files and have each tagged in its native format.
 */
class AutoFrameworkStrategy implements TagApplierStrategy {
  readonly name = "auto";

  constructor(
    private readonly rootDir: string,
    private readonly defaultFramework: TagFramework,
    private readonly frameworkOverrides: [pattern: string, framework: TagFramework][],
  ) {}

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(absPath: string, source: string, tags: string[]): string {
    const framework =
      detectFrameworkFromImports(source) ?? this.matchOverride(absPath) ?? this.defaultFramework;
    const strategy = (FRAMEWORK_STRATEGIES[framework] ?? FRAMEWORK_STRATEGIES.vitest)();
    return strategy.apply(absPath, source, tags);
  }

  private matchOverride(absPath: string): TagFramework | null {
    const relPath = path.relative(this.rootDir, absPath).split(path.sep).join("/");
    for (const [pattern, framework] of this.frameworkOverrides) {
      if (matchesGlob(pattern, relPath)) return framework;
    }
    return null;
  }
}

/**
 * @description Returns the ordered list of strategies to use for tag annotation.
 *   Language strategies (Gherkin, Pytest, Go) are always included and checked first.
 *   The auto-detecting framework strategy is appended last and handles TS/JS files.
 * @param {TagFramework} defaultFramework - Fallback TS/JS test framework used only when a file
 *   has no detectable framework import and no matching `frameworkOverrides` pattern. Defaults to
 *   `"vitest"`.
 * @param {Record<string, TagFramework>} frameworkOverrides - Path-glob pattern (project-relative)
 *   to fallback framework. Checked in object key order; the first pattern that matches a file's
 *   path wins. Only consulted when the file's own imports don't reveal a framework.
 * @param {string} rootDir - Absolute project root, used to compute each file's project-relative
 *   path for matching against `frameworkOverrides` patterns.
 * @returns {TagApplierStrategy[]} Strategies in priority order.
 */
export function createStrategies(
  defaultFramework: TagFramework = "vitest",
  frameworkOverrides: Record<string, TagFramework> = {},
  rootDir: string = process.cwd(),
): TagApplierStrategy[] {
  return [
    new GherkinStrategy(), // .feature
    new PytestStrategy(), // .py
    new GoStrategy(), // *_test.go
    new AutoFrameworkStrategy(rootDir, defaultFramework, Object.entries(frameworkOverrides)), // TS/JS, framework detected per file
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
  return strategies.find((strategy) => strategy.canHandle(absPath)) ?? null;
}
