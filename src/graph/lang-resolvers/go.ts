import fs from "node:fs";
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./index";

/**
 * @description Resolves Go module-local import paths to concrete `.go` files by reading
 *   the module name from `go.mod` and mapping the import path suffix to a package directory.
 *   All imports whose path does not start with the declared module name fall through as external.
 */
export class GoLangResolver implements LangResolver {
  extensions = [".go"];
  private moduleCache = new Map<string, string | null>();

  /**
   * @description Strips the Go module prefix from the specifier (read from `go.mod`) and resolves
   *   the remainder to a representative `.go` file inside the matching package directory.
   * @param {string} _currentFile - Absolute path of the importing file (unused; resolution is module-relative).
   * @param {string} specifier - Full Go import path, e.g. `"github.com/myorg/myrepo/internal/utils"`.
   * @param {string} rootDir - Absolute project root where `go.mod` is located.
   * @param {Function} _resolveLocal - Generic resolver callback (unused for Go).
   * @returns {ResolvedImport | null} Local file path, or `null` if the specifier is external or the package dir is missing.
   */
  resolve(
    _currentFile: string,
    specifier: string,
    rootDir: string,
    _resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport | null {
    const mod = this.readModule(rootDir);
    if (!mod) return null;
    if (specifier !== mod && !specifier.startsWith(mod + "/")) return null;

    const rel = specifier.slice(mod.length).replace(/^\//, "");
    if (!rel) return null;

    return resolveGoPackageDir(path.join(rootDir, rel));
  }

  /**
   * @description Reads and caches the module path declared in `go.mod` at the project root.
   *   Returns `null` if `go.mod` is absent or does not contain a `module` directive.
   * @param {string} rootDir - Absolute directory to look for `go.mod`.
   * @returns {string | null} The declared module path (e.g. `"github.com/myorg/myrepo"`), or `null`.
   */
  private readModule(rootDir: string): string | null {
    if (this.moduleCache.has(rootDir)) return this.moduleCache.get(rootDir)!;
    try {
      const content = fs.readFileSync(path.join(rootDir, "go.mod"), "utf-8");
      const line = content.split("\n").find((l) => l.startsWith("module "));
      const mod = line ? line.slice("module ".length).trim() : null;
      this.moduleCache.set(rootDir, mod);
      return mod;
    } catch {
      this.moduleCache.set(rootDir, null);
      return null;
    }
  }
}

/**
 * @description Finds a representative non-test `.go` file for a Go package directory.
 *   Prefers `doc.go` if present, otherwise the first file alphabetically.
 * @param {string} absDir - Absolute path to the Go package directory.
 * @returns {ResolvedImport | null} Resolved path, or `null` if the directory doesn't exist or has no Go files.
 */
function resolveGoPackageDir(absDir: string): ResolvedImport | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const goFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".go") && !e.name.endsWith("_test.go"))
    .map((e) => path.join(absDir, e.name))
    .sort();

  if (!goFiles.length) return null;

  const preferred = goFiles.find((f) => path.basename(f) === "doc.go") ?? goFiles[0]!;
  return { path: preferred, isExternal: false };
}
