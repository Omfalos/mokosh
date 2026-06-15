/** Shared types for language-specific import resolvers. */

/** @description The result of resolving a single import specifier to a concrete file path. */
export interface ResolvedImport {
  path: string;
  isExternal: boolean;
  /** True when resolved to a sibling workspace package. */
  isWorkspace?: boolean;
  /** Package name when `isWorkspace` is true (e.g. `"@myorg/shared"`). */
  workspacePackage?: string;
}

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
