/** Loads and applies mokosh.config.* files, activating user-defined matchers, patterns, and thresholds. */
import fs from "node:fs";
import path from "node:path";
import type { ParallelParsingOption } from "./graph/builder";
import {
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
  resetClassifyRegistries,
  setBarrelThreshold,
} from "./parser/classify";
import { configureTagQuality, resetTagQuality } from "./tag-quality";
import type { TagFramework } from "./tags/strategies";

/**
 * @description Top-level configuration for mokosh. All fields are optional; unset fields
 *   fall back to built-in defaults. Load this object via `loadMokoshConfig`, then activate
 *   it with `applyConfig` before calling `createImportMap`.
 */
export interface MokoshConfig {
  /** Additional directories to skip when scanning (merged with built-in defaults). */
  ignoreDirs?: string[];
  /**
   * Additional absolute (or project-root-relative) directories to fold into the workspace graph
   * as their own packages, outside `rootDir` — currently the only way to represent a Gradle
   * composite build (`includeBuild("../other-repo")`) that lives outside the analyzed checkout:
   * mokosh never auto-discovers such a path from a settings file, only from this explicit list
   * (see `docs/known_issues/22-gradle-composite-build-not-detected.md`). Each entry with no JVM
   * source files is silently skipped, the same tolerance an `include(...)`/`includeBuild(...)`
   * target pointing at an empty directory already has. Workspace-graph (`createWorkspaceGraph`)
   * only; ignored by `createImportMap`.
   */
  extraRoots?: string[];
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
  /**
   * Explicit path-alias map for import resolution, same shape as tsconfig's
   * `compilerOptions.paths` (e.g. `{ "@app/*": ["src/app/*"] }`). Takes precedence over
   * any aliases declared in `tsconfig.json`. Useful for JS-only projects without a
   * tsconfig, or to mirror Vite/webpack alias configs. Substitution paths are resolved
   * relative to the project root.
   */
  pathAliases?: Record<string, string[]>;
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
     * Fallback test framework whose tag format to use for TS/JS files. Each file's actual
     * framework is auto-detected from its imports (`@playwright/test`, `cypress`,
     * `@jest/globals`, `vitest`), so a single repo can mix frameworks and each file is tagged
     * in its own native format. This value is only used when a file has no detectable
     * framework import (e.g. `globals: true` configs with no explicit import).
     * - `"vitest"` — injects `{ tags: [...] }` in describe/test/it options (default)
     * - `"playwright"` — injects `{ tag: ["@name"] }` with `@` prefix convention
     * - `"cypress"` — injects `{ tags: ["@name"] }` for use with `@cypress/grep`
     * - `"jest"` — writes a `/** @group name *\/` docblock for use with `jest-runner-groups`
     */
    framework?: TagFramework;
    /**
     * Path-glob pattern (project-relative, e.g. `"tests/e2e/**"`) to fallback framework. Checked
     * in object key order, first match wins, before falling back further to `framework`. Only
     * consulted when a file's own imports don't reveal a framework — lets different directories
     * default to different frameworks (e.g. e2e tests using Playwright globals, unit tests using
     * Jest globals) instead of sharing one project-wide default.
     */
    frameworkOverrides?: Record<string, TagFramework>;
  };
  /**
   * Tunes which tags count as test-selection labels for `propose_tags`, `apply_tags`,
   * `list_tags` (default view) and the `tag:` query filter. Both lists are case-insensitive.
   */
  tags?: {
    /** Tag names to treat as noise, added to the built-in curated blocklist. */
    blocklist?: string[];
    /** Tag names to keep even when built-in- or user-blocked (overrides `blocklist`). */
    allowlist?: string[];
  };
  /** Path to the Istanbul/v8 `coverage-summary.json` file, relative to the project root. When set, `coveragePct` is populated on each node after the graph is built and takes priority over `coverage.mode`. */
  coverageReportPath?: string;
  /**
   * On-demand coverage: when `coverageReportPath` is not set, mokosh can populate `coveragePct`
   * itself instead of requiring a pre-generated report file. Off by default — see each `mode`.
   */
  coverage?: {
    /**
     * - `"static"` (recommended default) — instant, zero-execution *estimate*: how directly each
     *   file is reachable from a test via the import/call graph already built (see
     *   `computeStaticCoverage`, `docs/adr-023-on-demand-coverage.md`). Not a real line-coverage
     *   measurement — a reachable file can still have untested branches — but costs nothing
     *   beyond graph traversal, so it's always safe to leave on. Nodes it populates carry
     *   `coverageSource: "static"`.
     * - `"exec"` — real coverage: runs each detected test runner (vitest/jest,
     *   pytest+coverage.py, `go test -coverprofile`, Gradle JaCoCo, sbt scoverage — one per
     *   monorepo package, or once at the root for a single-language repo) and caches the merged
     *   result in `mokosh-cache/coverage-result.json`, keyed by a digest of every graph node's
     *   mtime/size plus `timeoutMs`/`packages`. A cache hit skips re-running the test suites
     *   entirely; any in-scope file change reruns every detected runner (no partial re-run).
     *   A side-effecting, potentially slow operation (network calls, DB writes, arbitrary build
     *   scripts) — use it when you need real numbers (e.g. before a release), not as the default.
     */
    mode: "static" | "exec";
    /** `mode: "exec"` only. Per-runner timeout in milliseconds before the spawned test process
     *  is killed and that runner's coverage is simply omitted (never fails the whole `analyze`).
     *  Default: 300000 (5 minutes). */
    timeoutMs?: number;
    /** `mode: "exec"` only. Restrict on-demand coverage to these monorepo package names (matches
     *  `WorkspacePackage.name`). Unset runs it for every detected package. Ignored for a
     *  single-language (non-monorepo) root. */
    packages?: string[];
  };
  /** Default line-coverage threshold (0–100) used by `find_uncovered`. Defaults to `80` when not specified. */
  coverageThreshold?: number;
  /**
   * Controls worker-pool offloading of file parsing (see docs/adr-010-parallel-parsing.md).
   * `true`/unset (default) enables it once a cheap pre-scan finds at least `minFiles`
   * (default 600, matching the measured crossover where pool startup cost pays off) files —
   * set `false` to always parse in-process, or pass `{ minFiles, maxThreads }` to lower or
   * raise the threshold for your own repo size.
   */
  parallelParsing?: ParallelParsingOption;
  /** Duplicate-detection (`find_duplicates` / `--find-duplicates`) tuning. */
  duplication?: {
    /**
     * Extra generated / vendored file patterns to exclude from duplicate scanning, merged with
     * the built-in list (protobuf output, `*.generated.*`, `generated/` dirs, `@generated`
     * markers). Two shapes only — `** /name/**` (any path segment equals `name`) and `*.suffix`
     * (basename ends with `.suffix`) — not full glob syntax.
     */
    ignoreGlobs?: string[];
    /** When true, scan generated / vendored files too (default false). Matches involving one are
     *  tagged `signals: ["generated"]`. */
    includeGenerated?: boolean;
    /** When true, include matches where every occurrence is in a single file (default false) —
     *  a file's own naturally repetitive structure is usually not actionable copy-paste. Matches
     *  are always tagged `signals: ["same-file"]` regardless of this setting. */
    includeSameFile?: boolean;
    /** When true, include matches whose occurrences are all inline SVG / SVG-shaped JSX markup
     *  (default false) — two different icons sharing a literal-normalized skeleton (block matcher)
     *  or a byte-identical `<defs>`/`<filter>` block (`defKind: "jsxElement"`), neither of which is
     *  usually an authored clone. Matches are always tagged `signals: ["svg-markup"]` regardless
     *  of this setting. */
    includeSvgMarkup?: boolean;
    /** When true, include matches in the `markdown` family (default false) — mirrored prose
     *  docs (README ↔ *.mdx) are not code duplication. Matches are always tagged
     *  `signals: ["docs"]` regardless. */
    includeDocs?: boolean;
    /** Which duplicates to surface, by test-file involvement (default `"src"`). `"src"` drops
     *  every cluster with a test-file occurrence; `"tests"` returns only substantive test
     *  clusters (shared setup/mocks/assertions, not render/snapshot skeletons); `"all"` returns
     *  everything. The `--scope` CLI flag overrides this. Matches are always tagged
     *  `signals: ["test"]` regardless of this setting. */
    scope?: "src" | "tests" | "all";
  };
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
 *   Call this after `loadMokoshConfig` and before `createImportMap`. Resets those registries
 *   first, so each call fully replaces the previously active config instead of accumulating on
 *   top of it — otherwise a project's matchers/patterns/libraries would permanently leak into
 *   every later `applyConfig` call in the same process (e.g. a different root analyzed in the
 *   same long-running MCP server session), and a config narrowed or emptied on disk could never
 *   actually shrink what was registered.
 * @param {MokoshConfig} config - The loaded config whose matchers, patterns, libraries, and thresholds are registered.
 */
export function applyConfig(config: MokoshConfig): void {
  resetClassifyRegistries();
  resetTagQuality();
  configureTagQuality(config.tags);
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

/**
 * @description Extracts the subset of `MokoshConfig` fields that affect graph
 *   construction (`gitStats`, `parallelParsing`, `pathAliases`, `ignoreDirs`, `extraRoots`) into a plain
 *   options object, ready to spread into `createImportMap`/`createWorkspaceGraph` calls. Single
 *   source of truth for this mapping so every graph-building call site — CLI, MCP,
 *   and secondary command-level rebuilds — stays in sync as new config fields are added.
 * @param config - The loaded config, or `undefined` when none has been loaded yet.
 * @returns Graph-build options with defaults applied (`gitStats` defaults to `false`).
 */
export function configToGraphOptions(config: MokoshConfig | undefined): {
  gitStats: boolean;
  parallelParsing: ParallelParsingOption | undefined;
  pathAliases: Record<string, string[]> | undefined;
  additionalIgnoreDirs: string[] | undefined;
  extraRoots: string[] | undefined;
} {
  return {
    gitStats: config?.gitStats ?? false,
    parallelParsing: config?.parallelParsing,
    pathAliases: config?.pathAliases,
    additionalIgnoreDirs: config?.ignoreDirs,
    extraRoots: config?.extraRoots,
  };
}
