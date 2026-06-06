import type { ResolvedImport } from "../resolver";

export type { ResolvedImport };

/**
 * @description Contract for language-specific import resolution strategies.
 *   Each implementation handles the quirks of one language's module system
 *   (e.g. Python dot-notation, Lua dot-paths, Go module paths).
 */
export interface LangResolver {
  /** File extensions this resolver handles, including the dot (e.g. `[".py"]`). */
  extensions: string[];
  /**
   * @description Attempts to resolve a bare (non-relative) specifier to a local file path.
   * @param {string} currentFile - Absolute path of the importing file.
   * @param {string} specifier - The raw import specifier from source.
   * @param {string} rootDir - Absolute project root directory.
   * @param {Function} resolveLocal - Callback into the generic resolver for file-extension probing.
   * @returns {ResolvedImport | null} Resolved path, or `null` to fall through to external.
   */
  resolve(
    currentFile: string,
    specifier: string,
    rootDir: string,
    resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport | null;
}

export { GoLangResolver } from "./go";
export { LuaLangResolver } from "./lua";
export { PythonLangResolver } from "./python";
