/** Shared helpers for monorepo detectors: package building, entry-point resolution, and glob pattern expansion. */
import fs from "node:fs";
import path from "node:path";
import { isDirectory, isFile } from "./fs-utils";
import type { WorkspacePackage } from "./types";

export { exists } from "./fs-utils";

/**
 * @description Reads `package.json` from `pkgRoot` and builds a `WorkspacePackage`.
 *   Returns `null` if no `package.json` exists, cannot be parsed, or the `name` field is absent.
 * @param {string} monorepoRoot - Absolute path to the monorepo root, used to compute `relativeRoot`.
 * @param {string} pkgRoot - Absolute path to the package directory to read.
 * @returns {WorkspacePackage | null} The built package descriptor, or `null` on failure.
 */
export function buildPackage(monorepoRoot: string, pkgRoot: string): WorkspacePackage | null {
  const pkgJsonPath = path.join(pkgRoot, "package.json");
  if (!fs.existsSync(pkgJsonPath)) return null;

  let pkgJson: { name?: string; main?: string; exports?: unknown } = {};
  try {
    pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as typeof pkgJson;
  } catch {
    return null;
  }

  const name = pkgJson.name;
  if (!name) return null;

  return {
    name,
    root: pkgRoot,
    relativeRoot: path.relative(monorepoRoot, pkgRoot),
    entryPoints: resolveEntryPoints(pkgRoot, pkgJson),
  };
}

/** Matches a runnable JS/TS module extension (`.js .mjs .cjs .jsx .ts .tsx .mts .cts`), so
 *  `exports` targets like `./package.json`, `./styles.css`, or `.d.ts` type stubs never become
 *  entry points. */
const ENTRY_MODULE_EXT = /\.[mc]?[jt]sx?$/;

/**
 * @description Pulls every leaf path string out of one `package.json` `exports` value — a bare
 *   string, or a conditions object (possibly nested, e.g.
 *   `{ node: { import: "./x.mjs" }, default: "./x.cjs" }`). `types` conditions and `.d.ts`
 *   targets are skipped.
 * @param {unknown} value - One `exports` value (a sub-path's target, or the whole `exports` string).
 * @param {(rel: string) => void} add - Called with each accepted relative target.
 */
function collectExportTargets(value: unknown, add: (rel: string) => void): void {
  if (typeof value === "string") {
    if (ENTRY_MODULE_EXT.test(value) && !value.endsWith(".d.ts")) add(value);
    return;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [condition, nested] of Object.entries(value as Record<string, unknown>)) {
      if (condition === "types") continue;
      collectExportTargets(nested, add);
    }
  }
}

/**
 * @description Derives entry point absolute paths from a package's `package.json`. Collects
 *   every `exports` sub-path target (`.`, `./client`, `./server`, …), then `main`, then common
 *   conventions (`src/index.ts`, etc.). Returns **all** candidates that exist on disk — so a
 *   multi-entry package gets a complete graph walk and API surface, not just its `.` entry. If
 *   nothing exists yet (pre-build), returns the first candidate as a seed.
 * @param {string} pkgRoot - Absolute path to the package directory.
 * @param {{ main?: string; exports?: unknown }} pkgJson - Parsed `package.json` object.
 * @returns {string[]} Resolved entry point absolute paths, in priority order, de-duplicated.
 */
export function resolveEntryPoints(
  pkgRoot: string,
  pkgJson: { main?: string; exports?: unknown },
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (rel: string): void => {
    const abs = path.join(pkgRoot, rel);
    if (!seen.has(abs)) {
      seen.add(abs);
      candidates.push(abs);
    }
  };

  const exp = pkgJson.exports;
  if (typeof exp === "string") {
    collectExportTargets(exp, add);
  } else if (exp && typeof exp === "object" && !Array.isArray(exp)) {
    for (const target of Object.values(exp as Record<string, unknown>)) {
      collectExportTargets(target, add);
    }
  }

  if (pkgJson.main) add(pkgJson.main);

  for (const c of ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx", "index.js"]) add(c);

  const existing = candidates.filter(isFile);
  return existing.length > 0 ? existing : candidates.slice(0, 1);
}

/**
 * @description Resolves workspace glob patterns (e.g. `packages/*`) to `WorkspacePackage` entries.
 *   Supports `*` (single directory segment) and `**` (recursive). Non-glob patterns are treated as literal paths.
 * @param {string} root - Absolute monorepo root directory used as the base for all patterns.
 * @param {string[]} patterns - Glob patterns from `package.json` `"workspaces"` or `pnpm-workspace.yaml`.
 * @returns {WorkspacePackage[]} All resolved packages found under the matching directories.
 */
export function resolveGlobPatterns(root: string, patterns: string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const normalised = pattern.replace(/\/$/, "").replace(/^\.\//, "");
    resolvePattern(root, normalised, seen, packages);
  }

  return packages;
}

/**
 * @description Dispatches a single normalised glob pattern to the appropriate resolver
 *   based on whether it contains no wildcard, a `**` recursive glob, or a `*` shallow glob.
 * @param {string} root - Absolute monorepo root used as the base for path resolution.
 * @param {string} pattern - A single normalised pattern (trailing slash and leading `./` already stripped).
 * @param {Set<string>} seen - Set of already-visited absolute paths; updated in place to prevent duplicates.
 * @param {WorkspacePackage[]} packages - Accumulator array that receives discovered packages.
 */
function resolvePattern(
  root: string,
  pattern: string,
  seen: Set<string>,
  packages: WorkspacePackage[],
): void {
  if (!pattern.includes("*")) {
    resolveLiteralPattern(root, pattern, seen, packages);
    return;
  }

  const segments = pattern.split("/");

  if (segments.includes("**")) {
    resolveRecursivePattern(root, segments, seen, packages);
  } else {
    resolveShallowPattern(root, segments, seen, packages);
  }
}

/**
 * @description Resolves a pattern with no wildcards as a literal directory path relative to `root`.
 *   Adds a `WorkspacePackage` if the directory exists and has not been visited before.
 * @param {string} root - Absolute monorepo root used to join the literal path and compute `relativeRoot`.
 * @param {string} pattern - A literal (non-glob) relative path, e.g. `"packages/core"`.
 * @param {Set<string>} seen - Set of already-visited absolute paths; updated in place to prevent duplicates.
 * @param {WorkspacePackage[]} packages - Accumulator array that receives discovered packages.
 */
function resolveLiteralPattern(
  root: string,
  pattern: string,
  seen: Set<string>,
  packages: WorkspacePackage[],
): void {
  const abs = path.join(root, pattern);
  if (seen.has(abs) || !isDirectory(abs)) return;
  seen.add(abs);
  const pkg = buildPackage(root, abs);
  if (pkg) packages.push(pkg);
}

/**
 * @description Resolves a `**` glob by walking all subdirectories under the base segment recursively.
 *   If the pattern starts with `**` itself the walk begins at `root`; otherwise at the first segment.
 * @param {string} root - Absolute monorepo root passed through to `walkRecursive` for `relativeRoot` computation.
 * @param {string[]} segments - Path segments of the pattern split on `/`, must contain `"**"`.
 * @param {Set<string>} seen - Set of already-visited absolute paths; updated in place to prevent duplicates.
 * @param {WorkspacePackage[]} packages - Accumulator array that receives discovered packages.
 */
function resolveRecursivePattern(
  root: string,
  segments: string[],
  seen: Set<string>,
  packages: WorkspacePackage[],
): void {
  const base = path.join(root, segments[0] === "**" ? "" : (segments[0] ?? ""));
  walkRecursive(root, base, seen, packages);
}

/**
 * @description Resolves a single-`*` glob by listing every immediate subdirectory of the base path.
 *   The base is everything before the first segment containing `*`, e.g. `packages` for `packages/*`.
 * @param {string} root - Absolute monorepo root used to join path segments and compute `relativeRoot`.
 * @param {string[]} segments - Path segments of the pattern split on `/`, must contain a `*` (but not `**`).
 * @param {Set<string>} seen - Set of already-visited absolute paths; updated in place to prevent duplicates.
 * @param {WorkspacePackage[]} packages - Accumulator array that receives discovered packages.
 */
function resolveShallowPattern(
  root: string,
  segments: string[],
  seen: Set<string>,
  packages: WorkspacePackage[],
): void {
  const starIdx = segments.findIndex((segment) => segment.includes("*"));
  const base = path.join(root, ...segments.slice(0, starIdx));

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(base, entry.name);
    if (seen.has(abs)) continue;
    seen.add(abs);
    const pkg = buildPackage(root, abs);
    if (pkg) packages.push(pkg);
  }
}

/**
 * @description Recursively walks `dir` looking for directories that contain a `package.json`,
 *   building a `WorkspacePackage` for each. Skips `node_modules` and hidden directories.
 * @param {string} monorepoRoot - Absolute path to the monorepo root, used to compute `relativeRoot`.
 * @param {string} dir - The directory to walk in this recursion step.
 * @param {Set<string>} seen - Set of already-visited absolute paths; updated in place to prevent duplicates.
 * @param {WorkspacePackage[]} packages - Accumulator array that receives discovered packages.
 */
function walkRecursive(
  monorepoRoot: string,
  dir: string,
  seen: Set<string>,
  packages: WorkspacePackage[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dir, entry.name);
    if (fs.existsSync(path.join(abs, "package.json")) && !seen.has(abs)) {
      seen.add(abs);
      const pkg = buildPackage(monorepoRoot, abs);
      if (pkg) packages.push(pkg);
    } else {
      walkRecursive(monorepoRoot, abs, seen, packages);
    }
  }
}
