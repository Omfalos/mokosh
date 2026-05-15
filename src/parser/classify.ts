/** A config matcher: substring, regex, or predicate tested against the lowercase basename. */
export type ConfigMatcher = string | RegExp | ((baseName: string) => boolean);

const builtinConfigMatchers: ConfigMatcher[] = [
  ".config.",
  "biome.json",
  "tsconfig.json",
  "package.json",
  ".prettierrc",
  ".eslintrc",
];

const userConfigMatchers: ConfigMatcher[] = [];

/**
 * @description Registers a custom config-file matcher used when categorising nodes.
 * Accepts a substring, regex, or predicate tested against the lowercase basename.
 * Call this before running `createImportMap` — e.g. in a `mokosh.config.ts`.
 * @param matcher - A substring, `RegExp`, or predicate function tested against the lowercase file basename.
 * @example
 * // Match any file whose basename contains ".myconfig."
 * registerConfigMatcher(".myconfig.");
 *
 * // Match via regex
 * registerConfigMatcher(/^vite\.config\./);
 *
 * // Match via predicate
 * registerConfigMatcher((name) => name.startsWith("jest.config"));
 */
export function registerConfigMatcher(matcher: ConfigMatcher): void {
  userConfigMatchers.push(matcher);
}

/**
 * @description Tests a lowercase basename against all built-in and user-registered config matchers.
 * @param baseName - The lowercase file basename to test, e.g. `"tsconfig.json"`.
 * @returns `true` if any registered matcher matches the basename.
 */
export function isConfigFile(baseName: string): boolean {
  return [...builtinConfigMatchers, ...userConfigMatchers].some((matcher) => {
    if (typeof matcher === "string") return baseName.includes(matcher);
    if (matcher instanceof RegExp) return matcher.test(baseName);
    return matcher(baseName);
  });
}

// ─── Test-pattern registry ────────────────────────────────────────────────────

const builtinTestPatterns: string[] = [".test.", ".spec.", "-test.", "-spec."];
const userTestPatterns: string[] = [];

/**
 * @description Registers an additional basename substring that marks a file as a test.
 * @param pattern - A substring matched against the file basename, e.g. `".unit."`.
 */
export function registerTestPattern(pattern: string): void {
  userTestPatterns.push(pattern);
}

/**
 * @description Returns all test-file basename patterns (built-in + user-registered).
 * @returns Combined array of substring patterns used to identify test files by basename.
 */
export function getTestPatterns(): string[] {
  return [...builtinTestPatterns, ...userTestPatterns];
}

// ─── Testing-library registry ─────────────────────────────────────────────────

const builtinTestLibraries: string[] = [
  "jest",
  "vitest",
  "playwright",
  "cypress",
  "@testing-library/",
];
const userTestLibraries: string[] = [];

/**
 * @description Registers an additional import specifier that indicates a test file.
 * @param lib - An import specifier substring, e.g. `"@my-org/test-utils"`.
 */
export function registerTestLibrary(lib: string): void {
  userTestLibraries.push(lib);
}

/**
 * @description Returns all testing-library import prefixes (built-in + user-registered).
 * @returns Combined array of import specifier substrings used to detect test files by their imports.
 */
export function getTestLibraries(): string[] {
  return [...builtinTestLibraries, ...userTestLibraries];
}

// ─── Barrel-threshold registry ────────────────────────────────────────────────

let currentBarrelThreshold = 0.8;

/**
 * @description Sets the minimum ratio of export-statements to total statements required
 * to classify a file as a barrel. Default is `0.8` (80%).
 * @param threshold - A value between 0 and 1; files where exports exceed this fraction of all statements are classified as barrels.
 */
export function setBarrelThreshold(threshold: number): void {
  currentBarrelThreshold = threshold;
}

/**
 * @description Returns the current barrel-detection threshold.
 * @returns The ratio (0–1) above which a file is classified as a barrel.
 */
export function getBarrelThreshold(): number {
  return currentBarrelThreshold;
}
