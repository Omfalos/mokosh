import fs from "node:fs";
import path from "node:path";
import {
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
  setBarrelThreshold,
} from "./parser/classify";

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
}

const CONFIG_FILENAMES = ["mokosh.config.js", "mokosh.config.cjs", "mokosh.config.json"];

/**
 * Loads a mokosh config file.
 *
 * When `isExplicitPath` is true, `rootDirOrPath` is treated as an absolute
 * path to the config file itself (supports `--config` CLI override).
 * Otherwise it is treated as a directory and the standard filenames are probed.
 *
 * JS/CJS configs may export a plain `MokoshConfig` object **or** a function
 * `(defaults: MokoshConfig) => MokoshConfig`. Side effects (e.g. `registerParser` calls)
 * execute automatically when the file is required.
 *
 * Pass `{ allowJs: false }` to skip `.js`/`.cjs` files and read only JSON.
 * The MCP server uses this mode to prevent arbitrary code execution via a
 * caller-supplied `root` pointing to a directory with a malicious config file.
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
 * Requires a JS/CJS config file and normalises its export.
 * Unwraps `.default` for ESM-interop, and calls the export if it is a factory function.
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
 * Applies a `MokoshConfig` to the global registries.
 * Call this after `loadMokoshConfig` and before `createImportMap`.
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
