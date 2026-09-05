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
  checkDocDrift: boolean;
  findUncovered: boolean;
  listTags: boolean;
  callers: boolean;
  file: string | undefined;
  packageName: string | undefined;
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
  findSymbol: boolean;
  functionName: string | undefined;
  apiSurface: boolean;
  applyTags: boolean;
  dryRun: boolean;
  initSkill: boolean;
  initConfig: boolean;
  force: boolean;
  dependencies: boolean;
  dependents: boolean;
  affected: boolean;
  testsOnly: boolean;
  changedSymbols: string[] | undefined;
  cached: boolean;
  depth: number | undefined;
  withMeta: boolean;
  withEdgeDetail: boolean;
  findComplexFunctions: boolean;
  metric: "cognitiveComplexity" | "complexity" | undefined;
  complexityThreshold: number | undefined;
  limit: number | undefined;
  findDuplicates: boolean;
  minDuplicateLines: number | undefined;
  includeGenerated: boolean;
  includeSameFile: boolean;
  includeSvgMarkup: boolean;
  duplicateScope: "src" | "tests" | "all" | undefined;
  findRiskHotspots: boolean;
  maxCoveragePct: number | undefined;
  minChurn: number | undefined;
  workspacePackages: boolean;
  workspaceAffected: boolean;
  clearCache: boolean;
  slim: boolean;
  watch: boolean;
  base: string | undefined;
  compareBranches: string | undefined;
  compareFull: boolean;
  compareMaxItems: number | undefined;
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
 * @description Parses a raw numeric CLI value, returning `undefined` for missing/empty input.
 * @param {string | undefined} raw - The raw string value from `nodeParseArgs`, if provided.
 * @returns {number | undefined} The parsed integer, or `undefined` if `raw` is falsy.
 */
function parseOptionalInt(raw: string | undefined): number | undefined {
  return raw ? parseInt(raw, 10) : undefined;
}

/**
 * @description Parses a raw comma-separated CLI value into a trimmed string array.
 * @param {string | undefined} raw - The raw comma-separated string from `nodeParseArgs`, if provided.
 * @returns {string[] | undefined} The trimmed parts, or `undefined` if `raw` is falsy.
 */
function parseCsv(raw: string | undefined): string[] | undefined {
  return raw ? raw.split(",").map((part) => part.trim()) : undefined;
}

/**
 * @description Validates `--scope` for `--find-duplicates`. Anything not one of the three known
 *   values (including absent) yields `undefined`, so `findDuplicates` applies its own default.
 * @param {string | undefined} raw - The raw `--scope` value.
 * @returns {"src" | "tests" | "all" | undefined} The validated scope, or `undefined`.
 */
function parseDuplicateScope(raw: string | undefined): "src" | "tests" | "all" | undefined {
  return raw === "src" || raw === "tests" || raw === "all" ? raw : undefined;
}

/**
 * @description Parses raw CLI tokens into a structured options object with all paths
 *   resolved to absolute values. `--root` is resolved first because the default cache path
 *   derives from it; every subsequent path argument is resolved relative to that root.
 * @param {string[]} cliTokens - Raw process arguments (everything after `node <script>`).
 * @returns {ParsedArgs} A fully populated `ParsedArgs` with boolean flags set and path arguments as absolute paths.
 */
export const OPTIONS = {
  root: { type: "string" },
  cache: { type: "string" },
  config: { type: "string" },
  query: { type: "string" },
  file: { type: "string" },
  package: { type: "string" },
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
  "check-doc-drift": { type: "boolean" },
  "find-uncovered": { type: "boolean" },
  "list-tags": { type: "boolean" },
  callers: { type: "boolean" },
  silent: { type: "boolean" },
  "query-help": { type: "boolean" },
  help: { type: "boolean" },
  "type-graph": { type: "boolean" },
  "module-responsibility": { type: "boolean" },
  "feature-graph": { type: "boolean" },
  "call-graph": { type: "boolean" },
  "find-symbol": { type: "boolean" },
  "api-surface": { type: "boolean" },
  "apply-tags": { type: "boolean" },
  "dry-run": { type: "boolean" },
  "init-skill": { type: "boolean" },
  "init-config": { type: "boolean" },
  force: { type: "boolean" },
  dependencies: { type: "boolean" },
  dependents: { type: "boolean" },
  affected: { type: "boolean" },
  "tests-only": { type: "boolean" },
  "changed-symbols": { type: "string" },
  cached: { type: "boolean" },
  depth: { type: "string" },
  "with-meta": { type: "boolean" },
  "with-edge-detail": { type: "boolean" },
  "find-complex-functions": { type: "boolean" },
  metric: { type: "string" },
  "complexity-threshold": { type: "string" },
  limit: { type: "string" },
  "find-duplicates": { type: "boolean" },
  "min-duplicate-lines": { type: "string" },
  "include-generated": { type: "boolean" },
  "include-same-file": { type: "boolean" },
  "include-svg-markup": { type: "boolean" },
  scope: { type: "string" },
  "find-risk-hotspots": { type: "boolean" },
  "max-coverage-pct": { type: "string" },
  "min-churn": { type: "string" },
  "workspace-packages": { type: "boolean" },
  "workspace-affected": { type: "boolean" },
  "clear-cache": { type: "boolean" },
  slim: { type: "boolean" },
  watch: { type: "boolean" },
  base: { type: "string" },
  "compare-branches": { type: "string" },
  "compare-full": { type: "boolean" },
  "compare-max-items": { type: "string" },
} as const;

/** The subset of `nodeParseArgs`'s `values` result the boolean-flag group builders read from.
 *  Keyed to `keyof typeof OPTIONS` (rather than a bare `Record<string, ...>`) so a typo'd flag
 *  name inside a group builder — e.g. `values["propose-tag"]` instead of `"propose-tags"` — is a
 *  compile error instead of silently resolving to `undefined ?? false` at runtime. */
type RawValues = Record<keyof typeof OPTIONS, string | boolean | undefined>;

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
    const token = cliTokens[i];
    if (token === undefined) continue;
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
 * @description Reads the graph-traversal and query boolean flags (mermaid/tag/test-impact
 *   output modes) off parsed CLI values, defaulting each to `false` when absent.
 * @param {RawValues} values - The `values` object from `nodeParseArgs`.
 * @returns {Pick<ParsedArgs, ...>} The traversal/query flag slice of `ParsedArgs`.
 */
function parseTraversalFlags(
  values: RawValues,
): Pick<
  ParsedArgs,
  | "mermaid"
  | "proposeTags"
  | "plain"
  | "affectedTests"
  | "detectFeatures"
  | "findUnused"
  | "excludeTests"
  | "checkCycles"
  | "checkDocDrift"
  | "findUncovered"
> {
  return {
    mermaid: (values.mermaid as boolean) ?? false,
    proposeTags: (values["propose-tags"] as boolean) ?? false,
    plain: (values.plain as boolean) ?? false,
    affectedTests: (values["affected-tests"] as boolean) ?? false,
    detectFeatures: (values["detect-features"] as boolean) ?? false,
    findUnused: (values["find-unused"] as boolean) ?? false,
    excludeTests: (values["exclude-tests"] as boolean) ?? false,
    checkCycles: (values["check-cycles"] as boolean) ?? false,
    checkDocDrift: (values["check-doc-drift"] as boolean) ?? false,
    findUncovered: (values["find-uncovered"] as boolean) ?? false,
  };
}

/**
 * @description Reads the introspection/output-shape boolean flags (tag listing, help, type/API
 *   surface reporting) off parsed CLI values, defaulting each to `false` when absent.
 * @param {RawValues} values - The `values` object from `nodeParseArgs`.
 * @returns {Pick<ParsedArgs, ...>} The introspection flag slice of `ParsedArgs`.
 */
function parseIntrospectionFlags(
  values: RawValues,
): Pick<
  ParsedArgs,
  | "listTags"
  | "callers"
  | "silent"
  | "queryHelp"
  | "typeGraph"
  | "moduleResponsibility"
  | "featureGraph"
  | "callGraph"
  | "findSymbol"
  | "apiSurface"
> {
  return {
    listTags: (values["list-tags"] as boolean) ?? false,
    callers: (values.callers as boolean) ?? false,
    silent: (values.silent as boolean) ?? false,
    queryHelp: (values["query-help"] as boolean) ?? false,
    typeGraph: (values["type-graph"] as boolean) ?? false,
    moduleResponsibility: (values["module-responsibility"] as boolean) ?? false,
    featureGraph: (values["feature-graph"] as boolean) ?? false,
    callGraph: (values["call-graph"] as boolean) ?? false,
    findSymbol: (values["find-symbol"] as boolean) ?? false,
    apiSurface: (values["api-surface"] as boolean) ?? false,
  };
}

/**
 * @description Reads the tag-application and dependency-lookup boolean flags off parsed CLI
 *   values, defaulting each to `false` when absent.
 * @param {RawValues} values - The `values` object from `nodeParseArgs`.
 * @returns {Pick<ParsedArgs, ...>} The workflow flag slice of `ParsedArgs`.
 */
function parseWorkflowFlags(
  values: RawValues,
): Pick<
  ParsedArgs,
  | "applyTags"
  | "dryRun"
  | "initSkill"
  | "initConfig"
  | "force"
  | "dependencies"
  | "dependents"
  | "affected"
  | "testsOnly"
  | "cached"
> {
  return {
    applyTags: (values["apply-tags"] as boolean) ?? false,
    dryRun: (values["dry-run"] as boolean) ?? false,
    initSkill: (values["init-skill"] as boolean) ?? false,
    initConfig: (values["init-config"] as boolean) ?? false,
    force: (values.force as boolean) ?? false,
    dependencies: (values.dependencies as boolean) ?? false,
    dependents: (values.dependents as boolean) ?? false,
    affected: (values.affected as boolean) ?? false,
    testsOnly: (values["tests-only"] as boolean) ?? false,
    cached: (values.cached as boolean) ?? false,
  };
}

/**
 * @description Reads the complexity/duplication/risk-analysis and workspace boolean flags off
 *   parsed CLI values, defaulting each to `false` when absent.
 * @param {RawValues} values - The `values` object from `nodeParseArgs`.
 * @returns {Pick<ParsedArgs, ...>} The analysis flag slice of `ParsedArgs`.
 */
function parseAnalysisFlags(
  values: RawValues,
): Pick<
  ParsedArgs,
  | "withMeta"
  | "withEdgeDetail"
  | "findComplexFunctions"
  | "findDuplicates"
  | "findRiskHotspots"
  | "workspacePackages"
  | "workspaceAffected"
  | "clearCache"
  | "slim"
  | "watch"
> {
  return {
    withMeta: (values["with-meta"] as boolean) ?? false,
    withEdgeDetail: (values["with-edge-detail"] as boolean) ?? false,
    findComplexFunctions: (values["find-complex-functions"] as boolean) ?? false,
    findDuplicates: (values["find-duplicates"] as boolean) ?? false,
    findRiskHotspots: (values["find-risk-hotspots"] as boolean) ?? false,
    workspacePackages: (values["workspace-packages"] as boolean) ?? false,
    workspaceAffected: (values["workspace-affected"] as boolean) ?? false,
    clearCache: (values["clear-cache"] as boolean) ?? false,
    slim: (values.slim as boolean) ?? false,
    watch: (values.watch as boolean) ?? false,
  };
}

/**
 * @description Parses raw CLI tokens into a structured options object with all paths
 *   resolved to absolute values. `--root` is resolved first because the default cache path
 *   derives from it; every subsequent path argument is resolved relative to that root. Boolean
 *   flags are delegated to four thematic group builders ({@link parseTraversalFlags},
 *   {@link parseIntrospectionFlags}, {@link parseWorkflowFlags}, {@link parseAnalysisFlags}) so
 *   this function's own cognitive complexity stays proportional to its remaining path/numeric
 *   parsing, not to the flat count of `?? false` defaults.
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

  const cacheValue = values.cache;
  const configValue = values.config;
  const metricRaw = values.metric;
  const rawValues = values as RawValues;

  return {
    rootDir,
    cachePath: cacheValue ? path.resolve(rootDir, cacheValue) : defaultCachePath,
    configPath: configValue ? path.resolve(rootDir, configValue) : undefined,
    query: values.query,
    file: values.file,
    packageName: values.package,
    typeFilter: values.type,
    functionName: values.function,
    filterPaths: parseCsv(values.paths),
    featureThreshold: parseOptionalInt(values["feature-threshold"]),
    minOutDegree: parseOptionalInt(values["min-out-degree"]),
    ...parseTraversalFlags(rawValues),
    ...parseIntrospectionFlags(rawValues),
    help: cliTokens.length === 0 || (values.help ?? false),
    ...parseWorkflowFlags(rawValues),
    changedSymbols: parseCsv(values["changed-symbols"]),
    depth: parseOptionalInt(values.depth),
    ...parseAnalysisFlags(rawValues),
    metric:
      metricRaw === "complexity" || metricRaw === "cognitiveComplexity" ? metricRaw : undefined,
    complexityThreshold: parseOptionalInt(values["complexity-threshold"]),
    limit: parseOptionalInt(values.limit),
    minDuplicateLines: parseOptionalInt(values["min-duplicate-lines"]),
    includeGenerated: (values["include-generated"] as boolean) ?? false,
    includeSameFile: (values["include-same-file"] as boolean) ?? false,
    includeSvgMarkup: (values["include-svg-markup"] as boolean) ?? false,
    duplicateScope: parseDuplicateScope(values.scope),
    maxCoveragePct: parseOptionalInt(values["max-coverage-pct"]),
    minChurn: parseOptionalInt(values["min-churn"]),
    base: values.base,
    compareBranches: values["compare-branches"],
    compareFull: (values["compare-full"] as boolean) ?? false,
    compareMaxItems: parseOptionalInt(values["compare-max-items"]),
    entryPoints: positionals,
  };
}
