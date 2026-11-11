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
 * @description Tests a lowercase basename against all built-in config matchers plus `extraMatchers`.
 * @param baseName - The lowercase file basename to test, e.g. `"tsconfig.json"`.
 * @param extraMatchers - User matchers to apply on top of the built-ins; defaults to the process-wide registry.
 * @returns `true` if any registered matcher matches the basename.
 */
export function isConfigFile(
  baseName: string,
  extraMatchers: readonly ConfigMatcher[] = userConfigMatchers,
): boolean {
  return [...builtinConfigMatchers, ...extraMatchers].some((matcher) => {
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

const DEFAULT_BARREL_THRESHOLD = 0.8;
let currentBarrelThreshold = DEFAULT_BARREL_THRESHOLD;

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

// ─── Registry reset ────────────────────────────────────────────────────────────

/**
 * @description Clears every user-registered config matcher, test pattern, and test library,
 *   and resets the barrel threshold to its default. These registries are process-global —
 *   not scoped per project root — so without a reset between projects, one root's
 *   `mokosh.config.json` settings would permanently leak into every other root analyzed
 *   afterward in the same long-running process (e.g. an MCP server session), and a config
 *   later narrowed or emptied could never actually shrink what's registered. `applyConfig`
 *   calls this before registering the new config's values so each call fully replaces the
 *   active registry state rather than accumulating on top of it, matching the documented
 *   contract that unset `MokoshConfig` fields fall back to built-in defaults.
 *
 *   Not safe to call while another `applyConfig` + graph build for a different root is
 *   still in flight — these registries have no per-root isolation, so overlapping builds
 *   were already able to observe each other's state before this function existed.
 */
export function resetClassifyRegistries(): void {
  userConfigMatchers.length = 0;
  userTestPatterns.length = 0;
  userTestLibraries.length = 0;
  currentBarrelThreshold = DEFAULT_BARREL_THRESHOLD;
}

// ─── Explicit classification config ──────────────────────────────────────────

/**
 * @description The user-configurable inputs to file classification, as an explicit value rather
 *   than process-global registry state. The parser takes one so classification no longer depends
 *   on which thread it runs in: parse workers don't share the main thread's registries, so
 *   anything not carried in the task payload was silently ignored on the pooled path. Built-in
 *   patterns/libraries/matchers are not repeated here — only the user additions and threshold.
 */
export interface ClassifyConfig {
  /** User-registered test-file basename substrings (on top of the built-ins). */
  testPatterns: readonly string[];
  /** User-registered testing-library import substrings (on top of the built-ins). */
  testLibraries: readonly string[];
  /** User-registered config-file matchers (on top of the built-ins). */
  configMatchers: readonly ConfigMatcher[];
  /** Export-statement ratio above which a file is classified as a barrel. */
  barrelThreshold: number;
}

/**
 * @description Snapshots the current process-wide registries (populated by `applyConfig` /
 *   `register*`) into an explicit {@link ClassifyConfig}.
 * @returns A copy of the user-registered patterns, libraries, matchers and the barrel threshold.
 */
export function getClassifyConfig(): ClassifyConfig {
  return {
    testPatterns: [...userTestPatterns],
    testLibraries: [...userTestLibraries],
    configMatchers: [...userConfigMatchers],
    barrelThreshold: currentBarrelThreshold,
  };
}

/**
 * @description Makes a {@link ClassifyConfig} safe to send to a worker thread. Predicate-function
 *   matchers can't cross the structured-clone boundary, so they are removed; strings and RegExps
 *   survive.
 * @param config - The config to prepare.
 * @returns The cloneable config and how many function matchers were dropped.
 */
export function toTransferableClassifyConfig(config: ClassifyConfig): {
  config: ClassifyConfig;
  droppedMatchers: number;
} {
  const configMatchers = config.configMatchers.filter((matcher) => typeof matcher !== "function");
  return {
    config: { ...config, configMatchers },
    droppedMatchers: config.configMatchers.length - configMatchers.length,
  };
}

/**
 * @description Classifies the user-configurable parts of a file, resolving the built-in lists
 *   against the explicit `config`.
 * @param config - The explicit classification config.
 * @returns Resolved predicates for test-pattern, config-file and test-library checks plus the barrel threshold.
 */
export function resolveClassifier(config: ClassifyConfig): {
  isTestFile: (baseName: string) => boolean;
  isConfig: (baseName: string) => boolean;
  isTestLibrary: (specifier: string) => boolean;
  barrelThreshold: number;
} {
  const patterns = [...builtinTestPatterns, ...config.testPatterns];
  const libraries = [...builtinTestLibraries, ...config.testLibraries];
  return {
    isTestFile: (baseName) => patterns.some((pattern) => baseName.includes(pattern)),
    isConfig: (baseName) => isConfigFile(baseName, config.configMatchers),
    isTestLibrary: (specifier) => libraries.some((lib) => specifier.includes(lib)),
    barrelThreshold: config.barrelThreshold,
  };
}
