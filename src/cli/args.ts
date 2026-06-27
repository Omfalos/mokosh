/** Parses command-line arguments into a structured ParsedArgs object. */
import path from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { DEFAULT_CACHE_DIR, DEFAULT_CACHE_FILE } from "./const";

export interface ParsedArgs {
  rootDir: string;
  cachePath: string;
  configPath: string | undefined;
  mermaid: boolean;
  proposeTags: boolean;
  plain: boolean;
  affectedTests: boolean;
  detectFeatures: boolean;
  featureThreshold: number | undefined;
  findUnused: boolean;
  excludeTests: boolean;
  checkCycles: boolean;
  findUncovered: boolean;
  callers: boolean;
  file: string | undefined;
  silent: boolean;
  query: string | undefined;
  queryHelp: boolean;
  entryPoints: string[];
  help: boolean;
  typeGraph: boolean;
  typeFilter: string | undefined;
  moduleResponsibility: boolean;
  filterPaths: string[] | undefined;
  minOutDegree: number | undefined;
  featureGraph: boolean;
  callGraph: boolean;
  functionName: string | undefined;
  apiSurface: boolean;
}

/**
 * @description Extracts and resolves the `--root` argument from raw CLI tokens, falling back to
 *   the current working directory when the flag is absent.
 * @param {string[]} cliTokens - Raw process arguments (everything after `node <script>`).
 * @returns {string} Absolute path to use as the project root.
 */
function resolveRootDir(cliTokens: string[]): string {
  for (let i = 0; i < cliTokens.length; i++) {
    if (cliTokens[i] === "--root" && cliTokens[i + 1]) {
      return path.resolve(cliTokens[i + 1] as string);
    }
  }
  return process.cwd();
}

/**
 * @description Parses raw CLI tokens into a structured options object with all paths
 *   resolved to absolute values. `--root` is resolved first because the default cache path
 *   derives from it; every subsequent path argument is resolved relative to that root.
 * @param {string[]} cliTokens - Raw process arguments (everything after `node <script>`).
 * @returns {ParsedArgs} A fully populated `ParsedArgs` with boolean flags set and path arguments as absolute paths.
 */
const OPTIONS = {
  root: { type: "string" },
  cache: { type: "string" },
  config: { type: "string" },
  query: { type: "string" },
  file: { type: "string" },
  type: { type: "string" },
  paths: { type: "string" },
  function: { type: "string" },
  "feature-threshold": { type: "string" },
  "min-out-degree": { type: "string" },
  mermaid: { type: "boolean" },
  "propose-tags": { type: "boolean" },
  plain: { type: "boolean" },
  "affected-tests": { type: "boolean" },
  "detect-features": { type: "boolean" },
  "find-unused": { type: "boolean" },
  "exclude-tests": { type: "boolean" },
  "check-cycles": { type: "boolean" },
  "find-uncovered": { type: "boolean" },
  callers: { type: "boolean" },
  silent: { type: "boolean" },
  "query-help": { type: "boolean" },
  help: { type: "boolean" },
  "type-graph": { type: "boolean" },
  "module-responsibility": { type: "boolean" },
  "feature-graph": { type: "boolean" },
  "call-graph": { type: "boolean" },
  "api-surface": { type: "boolean" },
} as const;

const STRING_FLAGS = new Set(
  Object.entries(OPTIONS)
    .filter(([, v]) => v.type === "string")
    .map(([k]) => `--${k}`),
);

/**
 * @description Strips unknown flags and dangling string flags (value-expecting flags
 *   with no value following them) so `nodeParseArgs` never sees ambiguous input.
 *   Unknown flags are silently dropped; dangling string flags fall back to their defaults.
 * @param {string[]} cliTokens - Raw CLI tokens to sanitize.
 * @returns {string[]} A cleaned token list safe to pass to `nodeParseArgs`.
 */
function sanitizeTokens(cliTokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < cliTokens.length; i++) {
    const token = cliTokens[i]!;
    if (!token.startsWith("--")) {
      result.push(token);
    } else if (STRING_FLAGS.has(token)) {
      const valueToken = cliTokens[i + 1];
      if (valueToken !== undefined && !valueToken.startsWith("--")) {
        result.push(token, valueToken);
        i++;
      }
      // dangling string flag — drop it, default applies
    } else if (token.slice(2) in OPTIONS) {
      result.push(token); // known boolean flag
    }
    // unknown flag — silently drop
  }
  return result;
}

/**
 * @description Parses raw CLI tokens into a structured options object with all paths
 *   resolved to absolute values. `--root` is resolved first because the default cache path
 *   derives from it; every subsequent path argument is resolved relative to that root.
 * @param {string[]} cliTokens - Raw process arguments (everything after `node <script>`).
 * @returns {ParsedArgs} A fully populated `ParsedArgs` with boolean flags set and path arguments as absolute paths.
 */
export function parseArgs(cliTokens: string[]): ParsedArgs {
  const rootDir = resolveRootDir(cliTokens);
  const defaultCachePath = path.join(path.resolve(rootDir, DEFAULT_CACHE_DIR), DEFAULT_CACHE_FILE);

  const { values, positionals } = nodeParseArgs({
    args: sanitizeTokens(cliTokens),
    allowPositionals: true,
    options: OPTIONS,
  });

  const featureThresholdRaw = values["feature-threshold"];
  const minOutDegreeRaw = values["min-out-degree"];
  const filterPathsRaw = values["paths"];
  const cacheValue = values["cache"];
  const configValue = values["config"];

  return {
    rootDir,
    cachePath: cacheValue ? path.resolve(rootDir, cacheValue) : defaultCachePath,
    configPath: configValue ? path.resolve(rootDir, configValue) : undefined,
    query: values["query"],
    file: values["file"],
    typeFilter: values["type"],
    functionName: values["function"],
    filterPaths: filterPathsRaw
      ? filterPathsRaw.split(",").map((pathStr) => pathStr.trim())
      : undefined,
    featureThreshold: featureThresholdRaw ? parseInt(featureThresholdRaw, 10) : undefined,
    minOutDegree: minOutDegreeRaw ? parseInt(minOutDegreeRaw, 10) : undefined,
    mermaid: values["mermaid"] ?? false,
    proposeTags: values["propose-tags"] ?? false,
    plain: values["plain"] ?? false,
    affectedTests: values["affected-tests"] ?? false,
    detectFeatures: values["detect-features"] ?? false,
    findUnused: values["find-unused"] ?? false,
    excludeTests: values["exclude-tests"] ?? false,
    checkCycles: values["check-cycles"] ?? false,
    findUncovered: values["find-uncovered"] ?? false,
    callers: values["callers"] ?? false,
    silent: values["silent"] ?? false,
    queryHelp: values["query-help"] ?? false,
    help: cliTokens.length === 0 || (values["help"] ?? false),
    typeGraph: values["type-graph"] ?? false,
    moduleResponsibility: values["module-responsibility"] ?? false,
    featureGraph: values["feature-graph"] ?? false,
    callGraph: values["call-graph"] ?? false,
    apiSurface: values["api-surface"] ?? false,
    entryPoints: positionals,
  };
}
