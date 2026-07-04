/** Loads and applies mokosh.config.* files, activating user-defined matchers, patterns, and thresholds. */
import fs from "node:fs";
import path from "node:path";
import {
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
  setBarrelThreshold,
} from "./parser/classify";
import type { TagFramework } from "./tags/strategies";

/**
 * @description Top-level configuration for mokosh. All fields are optional; unset fields
 *   fall back to built-in defaults. Load this object via `loadMokoshConfig`, then activate
 *   it with `applyConfig` before calling `createImportMap`.
 */
export interface MokoshConfig {
  /** Additional directories to skip when scanning (merged with built-in defaults). */
  ignoreDirs?: string[];
  /** Additional file extensions to scan (merged with built-in defaults). */
  extensions?: string[];
  /** Override the default cache path (`mokosh-cache/graph.json`). */
  cachePath?: string;
  /** Default entry points used when none are provided on the CLI. */
  entryPoints?: string[];
  /** Additional basename substrings that mark a file as `"config"` category. */
  configMatchers?: string[];
  /** Additional basename substrings that mark a file as `"test"` category (e.g. `".unit."`). */
  testPatterns?: string[];
  /** Additional import specifiers that indicate a test file (e.g. `"@my-org/test-utils"`). */
  testLibraries?: string[];
  /** Ratio of export-statements to total statements required for `"barrel"` classification. Default: `0.8`. */
  barrelThreshold?: number;
  /** When true, enriches each node with `commitCount90d` and `lastAuthor` via git log. Only fetched for new/modified files. */
  gitStats?: boolean;
  /**
   * Tag-applier configuration for `--apply-tags`. Controls which format is written into
   * test files. Defaults to `{ framework: "vitest" }` when unset.
   */
  tagApplier?: {
    /**
     * The test framework whose tag format to use.
     * - `"vitest"` — injects `{ tags: [...] }` in describe/test/it options (default)
     * - `"playwright"` — injects `{ tag: ["@name"] }` with `@` prefix convention
     * - `"cypress"` — injects `{ tags: ["@name"] }` for use with `@cypress/grep`
     */
    framework?: TagFramework;
  };
  /** Path to the Istanbul/v8 `coverage-summary.json` file, relative to the project root. When set, `coveragePct` is populated on each node after the graph is built. */
  coverageReportPath?: string;
  /** Default line-coverage threshold (0–100) used by `find_uncovered`. Defaults to `80` when not specified. */
  coverageThreshold?: number;
}

const CONFIG_FILENAMES = ["mokosh.config.js", "mokosh.config.cjs", "mokosh.config.json"];

/**
 * @description Loads a mokosh config file, probing standard filenames in `rootDirOrPath` or reading an explicit path when `isExplicitPath` is true.
 *   JS/CJS configs may export a plain object or a factory function; the MCP server passes `allowJs: false` to prevent arbitrary code execution.
 * @param {string} rootDirOrPath - Directory to probe for standard config filenames, or absolute path to the config file when `isExplicitPath` is true.
 * @param {{ allowJs?: boolean; isExplicitPath?: boolean }} options - `allowJs` (default `true`) controls whether `.js`/`.cjs` files are loaded; `isExplicitPath` treats the first arg as a direct file path.
 * @returns {MokoshConfig} The parsed config, or an empty object when no config file is found.
 */
export function loadMokoshConfig(
  rootDirOrPath: string,
  { allowJs = true, isExplicitPath = false }: { allowJs?: boolean; isExplicitPath?: boolean } = {},
): MokoshConfig {
  if (isExplicitPath) {
    const filePath = path.resolve(rootDirOrPath);
    if (!fs.existsSync(filePath)) return {};
    if (filePath.endsWith(".json")) return readJsonConfig(filePath);
    if (allowJs) return readJsConfig(filePath);
    return {};
  }

  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.resolve(rootDirOrPath, filename);
    if (!fs.existsSync(filePath)) continue;
    if (filename.endsWith(".json")) return readJsonConfig(filePath);
    if (allowJs) return readJsConfig(filePath);
  }

  return {};
}

/** Parses a JSON config file into a `MokoshConfig`. */
function readJsonConfig(filePath: string): MokoshConfig {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as MokoshConfig;
}

/**
 * @description Requires a JS/CJS config file and normalises its export.
 *   Unwraps `.default` for ESM-interop, and calls the export if it is a factory function.
 * @param {string} filePath - Absolute path to the `.js` or `.cjs` config file
 * @returns {MokoshConfig} The resolved config object
 */
function readJsConfig(filePath: string): MokoshConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let exported = require(filePath) as MokoshConfig | ((defaults: MokoshConfig) => MokoshConfig);
  if (exported && typeof exported === "object" && "default" in exported) {
    exported = (exported as { default: typeof exported }).default;
  }
  return typeof exported === "function" ? exported({}) : (exported as MokoshConfig);
}

/**
 * @description Applies a `MokoshConfig` to the global registries that control classification and scanning.
 *   Call this after `loadMokoshConfig` and before `createImportMap`.
 * @param {MokoshConfig} config - The loaded config whose matchers, patterns, libraries, and thresholds are registered.
 */
export function applyConfig(config: MokoshConfig): void {
  for (const pattern of config.configMatchers ?? []) {
    registerConfigMatcher(pattern);
  }
  for (const pattern of config.testPatterns ?? []) {
    registerTestPattern(pattern);
  }
  for (const lib of config.testLibraries ?? []) {
    registerTestLibrary(lib);
  }
  if (config.barrelThreshold !== undefined) {
    setBarrelThreshold(config.barrelThreshold);
  }
}
