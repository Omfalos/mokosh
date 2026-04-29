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
 * Registers a custom config-file matcher used when categorising nodes.
 * Call this before running `createImportMap` — e.g. in a `mokosh.config.ts`.
 *
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

/** Tests a lowercase basename against all built-in and user-registered config matchers. */
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

/** Registers an additional basename substring that marks a file as a test (e.g. `".unit."`). */
export function registerTestPattern(pattern: string): void {
  userTestPatterns.push(pattern);
}

/** Returns all test-file basename patterns (built-in + user-registered). */
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

/** Registers an additional import specifier that indicates a test file (e.g. `"@my-org/test-utils"`). */
export function registerTestLibrary(lib: string): void {
  userTestLibraries.push(lib);
}

/** Returns all testing-library import prefixes (built-in + user-registered). */
export function getTestLibraries(): string[] {
  return [...builtinTestLibraries, ...userTestLibraries];
}

// ─── Barrel-threshold registry ────────────────────────────────────────────────

let currentBarrelThreshold = 0.8;

/**
 * Sets the minimum ratio of export-statements to total statements required
 * to classify a file as a barrel. Default is `0.8` (80%).
 */
export function setBarrelThreshold(threshold: number): void {
  currentBarrelThreshold = threshold;
}

/** Returns the current barrel-detection threshold. */
export function getBarrelThreshold(): number {
  return currentBarrelThreshold;
}
