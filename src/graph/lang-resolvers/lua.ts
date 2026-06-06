import fs from "node:fs";
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./index";

/**
 * @description Resolves Lua dot-separated module names (e.g. `utils.string`) to local files
 *   by converting dots to path separators and probing the project root and a `lib/` sub-directory.
 */
export class LuaLangResolver implements LangResolver {
  extensions = [".lua"];

  /**
   * @description Converts dots in the specifier to path separators and probes the project root
   *   and a `lib/` subdirectory using the generic resolver's extension-probing logic.
   * @param {string} _currentFile - Absolute path of the importing file (unused; search is root-relative).
   * @param {string} specifier - Dot-separated Lua module name, e.g. `"utils.string"`.
   * @param {string} rootDir - Absolute project root used as the primary search base.
   * @param {Function} resolveLocal - Generic resolver callback for extension and index-file probing.
   * @returns {ResolvedImport | null} Local file path, or `null` if no match is found.
   */
  resolve(
    _currentFile: string,
    specifier: string,
    rootDir: string,
    resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport | null {
    const luaSpecifier = specifier.replace(/\./g, path.sep);
    const searchBases = [rootDir, path.join(rootDir, "lib")];

    for (const base of searchBases) {
      if (!fs.existsSync(base)) continue;
      const resolved = resolveLocal(path.join(base, "_dummy.lua"), luaSpecifier);
      if (resolved) return resolved;
    }

    return null;
  }
}
