/** Language resolver for Python: maps bare module specifiers to local .py files or __init__.py packages. */
import fs from "node:fs";
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./types";

/**
 * @description Resolves bare Python module names (e.g. `mymodule` or `mypackage.sub`)
 *   to local `.py` files or `__init__.py` packages inside the project root.
 *   Dots in the specifier are treated as path separators.
 */
export class PythonLangResolver implements LangResolver {
  extensions = [".py"];

  /**
   * @description Converts dots in the specifier to path separators and probes for a matching
   *   `.py` file or `__init__.py` package relative to the project root.
   * @param {string} _currentFile - Absolute path of the importing file (unused; resolution is root-relative).
   * @param {string} specifier - Bare module name, e.g. `"mypackage.sub"`.
   * @param {string} rootDir - Absolute project root used as the search base.
   * @param {Function} _resolveLocal - Generic resolver callback (unused for Python).
   * @returns {ResolvedImport[] | null} Single-element array with the local file, or `null` if no match is found.
   */
  resolve(
    _currentFile: string,
    specifier: string,
    rootDir: string,
    _resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport[] | null {
    const pyPath = specifier.replace(/\./g, path.sep);

    const pyFile = path.join(rootDir, `${pyPath}.py`);
    if (isFile(pyFile)) return [{ path: pyFile, isExternal: false }];

    const initFile = path.join(rootDir, pyPath, "__init__.py");
    if (isFile(initFile)) return [{ path: initFile, isExternal: false }];

    return null;
  }
}

/**
 * @description Safely checks whether a path refers to a regular file without throwing on missing entries.
 * @param {string} p - Absolute path to test.
 * @returns {boolean} `true` if the path exists and is a regular file.
 */
function isFile(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}
