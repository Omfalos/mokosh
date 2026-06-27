/** Language resolver for Go: maps module-local import paths to concrete .go files using go.mod. */
import fs from "node:fs";
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./types";

interface GoModData {
  /** Declared module path, e.g. `"github.com/myorg/myrepo"`. */
  mod: string | null;
  /**
   * `replace` directive map: module path (without version) → absolute local directory.
   * Only local-path replacements (`=> ./foo` or `=> /abs/path`) are recorded;
   * version-to-version redirects (`=> otherpkg v1.2.3`) are ignored.
   */
  replaces: Map<string, string>;
}

/**
 * @description Resolves Go module-local import paths to all concrete `.go` source files
 *   in the target package directory, using `go.mod` for module name and `replace` directives.
 *
 *   Two gaps addressed over the previous single-file resolver:
 *   1. Returns every non-test `.go` file in the package directory (one edge per file).
 *   2. Honours `replace` directives that redirect a module path to a local directory.
 *
 *   Known remaining limitations (see ADR-007):
 *   - Vendor directories are not traversed.
 *   - `go.work` workspace files are not read.
 */
export class GoLangResolver implements LangResolver {
  extensions = [".go"];
  private goModCache = new Map<string, GoModData>();

  /**
   * @description Resolves a Go import specifier to all non-test `.go` files in the target
   *   package directory. Returns `null` for stdlib, third-party, and root-module imports.
   * @param {string} _currentFile - Absolute path of the importing file (unused; resolution is module-relative).
   * @param {string} specifier - Full Go import path, e.g. `"github.com/myorg/myrepo/internal/utils"`.
   * @param {string} rootDir - Absolute project root where `go.mod` is located.
   * @param {Function} _resolveLocal - Generic resolver callback (unused for Go).
   * @returns {ResolvedImport[] | null} All non-test `.go` files in the package, or `null` if external/unresolvable.
   */
  resolve(
    _currentFile: string,
    specifier: string,
    rootDir: string,
    _resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport[] | null {
    const { mod, replaces } = this.readGoMod(rootDir);
    if (!mod) return null;

    // Check replace directives first — they can redirect any module path prefix.
    const redirected = this.applyReplace(specifier, replaces, rootDir);
    if (redirected !== undefined) {
      return goFilesInDir(redirected);
    }

    // Standard module-local resolution: specifier must start with the declared module name.
    if (specifier !== mod && !specifier.startsWith(`${mod}/`)) return null;

    const rel = specifier.slice(mod.length).replace(/^\//, "");
    if (!rel) return null;

    return goFilesInDir(path.join(rootDir, rel));
  }

  /**
   * @description Reads and caches `go.mod` from the project root, extracting the module
   *   name and any local `replace` directives.
   * @param {string} rootDir - Absolute directory containing `go.mod`.
   * @returns {GoModData} Parsed module data; `mod` is `null` when `go.mod` is absent or malformed.
   */
  private readGoMod(rootDir: string): GoModData {
    const cached = this.goModCache.get(rootDir);
    if (cached !== undefined) return cached;

    const empty: GoModData = { mod: null, replaces: new Map() };
    try {
      const content = fs.readFileSync(path.join(rootDir, "go.mod"), "utf-8");
      const data = parseGoMod(content, rootDir);
      this.goModCache.set(rootDir, data);
      return data;
    } catch {
      this.goModCache.set(rootDir, empty);
      return empty;
    }
  }

  /**
   * @description Checks whether the specifier matches any `replace` directive and returns
   *   the absolute local directory it maps to, or `undefined` if no match.
   *
   *   A replace directive `replace A => ./local` matches specifier `A/pkg/sub`
   *   and maps it to `<rootDir>/local/pkg/sub`.
   * @param {string} specifier - The import path to check.
   * @param {Map<string, string>} replaces - Parsed replace map: module prefix → absolute dir.
   * @param {string} rootDir - Project root, used when replacing relative paths.
   * @returns {string | undefined} Absolute target directory, or `undefined` if no directive matches.
   */
  private applyReplace(
    specifier: string,
    replaces: Map<string, string>,
    rootDir: string,
  ): string | undefined {
    for (const [from, toDir] of replaces) {
      if (specifier === from) {
        return toDir;
      }
      if (specifier.startsWith(`${from}/`)) {
        const sub = specifier.slice(from.length + 1);
        return path.join(toDir, sub);
      }
    }
    // Unused parameter kept to avoid signature drift — rootDir is used during parsing.
    void rootDir;
    return undefined;
  }
}

/**
 * @description Parses a `go.mod` file and extracts the declared module name and all
 *   local-path `replace` directives.
 *
 *   Handles both block form (`replace ( ... )`) and single-line form (`replace A => B`).
 *   Only records directives whose replacement target is a relative or absolute local path
 *   (starts with `.` or `/`). Version-to-version redirects are skipped.
 * @param {string} content - Raw text of `go.mod`.
 * @param {string} rootDir - Project root, used to resolve relative replacement paths.
 * @returns {GoModData} Parsed module name and replace map.
 */
function parseGoMod(content: string, rootDir: string): GoModData {
  const lines = content.split("\n");
  let mod: string | null = null;
  const replaces = new Map<string, string>();

  let inReplaceBlock = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("module ")) {
      mod = line.slice("module ".length).trim();
      continue;
    }

    // Block open: `replace (`
    if (/^replace\s*\(/.test(line)) {
      inReplaceBlock = true;
      continue;
    }

    // Block close
    if (inReplaceBlock && line === ")") {
      inReplaceBlock = false;
      continue;
    }

    // Line inside a replace block, e.g. `github.com/org/repo => ../local`
    if (inReplaceBlock && line.includes("=>")) {
      parseReplaceLine(line, rootDir, replaces);
      continue;
    }

    // Single-line replace: `replace github.com/org/repo => ../local`
    if (!inReplaceBlock && /^replace\s+/.test(line) && line.includes("=>")) {
      parseReplaceLine(line.replace(/^replace\s+/, ""), rootDir, replaces);
    }
  }

  return { mod, replaces };
}

/**
 * @description Parses a single replace directive line (without the leading `replace` keyword)
 *   and records it in `out` when the target is a local path.
 *
 *   Line forms:
 *   - `github.com/org/repo => ./local`
 *   - `github.com/org/repo v1.0.0 => ./local`
 *   - `github.com/org/repo => /absolute/path`
 *
 *   Version-to-version targets (`=> other/module v1.2.3`) are ignored.
 * @param {string} line - Trimmed directive text after stripping the `replace` keyword.
 * @param {string} rootDir - Project root for resolving relative replacement paths.
 * @param {Map<string, string>} out - Map to populate with resolved replacements.
 */
function parseReplaceLine(line: string, rootDir: string, out: Map<string, string>): void {
  const [lhs, rhs] = line.split("=>").map((side) => side.trim());
  if (!lhs || !rhs) return;

  // Strip optional version from lhs: `github.com/org/repo v1.0.0` → `github.com/org/repo`
  const fromModule = lhs.split(/\s+/)[0] as string;

  // Only handle local path targets (relative or absolute)
  if (!rhs.startsWith(".") && !rhs.startsWith("/")) return;

  const absTarget = path.isAbsolute(rhs) ? rhs : path.resolve(rootDir, rhs);
  out.set(fromModule, absTarget);
}

/**
 * @description Returns all non-test `.go` files in a package directory as resolved imports.
 *   Files ending in `_test.go` are excluded — they are discovered separately by the builder's
 *   test-file scan and should not appear as dependency targets.
 * @param {string} absDir - Absolute path to the Go package directory.
 * @returns {ResolvedImport[] | null} Array of resolved imports, or `null` if the directory
 *   is missing or contains no non-test Go files.
 */
function goFilesInDir(absDir: string): ResolvedImport[] | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const files = entries
    .filter(
      (dirent) =>
        dirent.isFile() && dirent.name.endsWith(".go") && !dirent.name.endsWith("_test.go"),
    )
    .map((dirent): ResolvedImport => ({ path: path.join(absDir, dirent.name), isExternal: false }))
    .sort((resolvedA, resolvedB) => resolvedA.path.localeCompare(resolvedB.path));

  return files.length > 0 ? files : null;
}
