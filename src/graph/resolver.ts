import fs from "node:fs";
import path from "node:path";

/**
 * @description Contract for resolving an import specifier to an absolute file path
 *   given the file that contains the import.
 */
export interface PathResolver {
  /**
   * @description Resolves an import specifier to an absolute path and whether it is
   *   outside the project root.
   * @param currentFile - Absolute path of the file containing the import statement.
   * @param specifier - The raw import specifier string (e.g. `"./utils"` or `"lodash"`).
   * @returns Resolved path and external flag, or `null` if resolution fails.
   */
  resolve(currentFile: string, specifier: string): { path: string; isExternal: boolean } | null;
}

/**
 * @description Default import resolver that handles relative paths, absolute paths,
 *   tsconfig path aliases, Lua dot-separated modules, and external node_modules.
 */
export class DefaultResolver implements PathResolver {
  /**
   * @param rootDir - Absolute path to the project root, used as the boundary for
   *   deciding whether a resolved path is internal or external.
   */
  constructor(private rootDir: string) {}

  /**
   * @description Resolves a specifier by trying path aliases first, then relative/absolute
   *   local paths, then Lua dot-notation, and finally treating the specifier as an external module.
   * @param currentFile - Absolute path of the file containing the import.
   * @param specifier - The raw import specifier to resolve.
   * @returns Resolved path and external flag, or `null` if no local file can be found.
   */
  public resolve(
    currentFile: string,
    specifier: string,
  ): { path: string; isExternal: boolean } | null {
    // 1. Try Path Aliases (tsconfig.json paths)
    const aliased = this.resolvePathAlias(specifier);
    if (aliased) return aliased;

    // 2. Handle Relative or Absolute Local Paths
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      return this.resolveLocalPath(currentFile, specifier);
    }

    // 3. Lua-specific resolution: Try converting dots to path separators
    if (currentFile.endsWith(".lua") && !specifier.startsWith(".") && !specifier.startsWith("/")) {
      const luaSpecifier = specifier.replace(/\./g, path.sep);
      // We try resolving relative to root and specifically "lib" if it exists,
      // as many Lua projects use a lib/ folder.
      const pathsToTry = [this.rootDir, path.join(this.rootDir, "lib")];

      for (const baseDir of pathsToTry) {
        if (!fs.existsSync(baseDir)) continue;
        const resolved = this.resolveLocalPath(path.join(baseDir, "dummy.lua"), luaSpecifier);
        if (resolved) return resolved;
      }
    }

    // 4. Non-relative, non-absolute import (likely a node_module or built-in)
    return { path: specifier, isExternal: true };
  }

  /**
   * @description Resolves a relative or absolute specifier to a concrete file path by
   *   trying multiple extensions and index-file fallbacks, including ESM `.js`→`.ts` rewriting.
   * @param currentFile - Absolute path of the importing file, used to compute the base directory.
   * @param specifier - A relative (`./foo`) or absolute (`/foo`) import specifier.
   * @returns Resolved path and external flag, or `null` if no matching file is found within the project.
   */
  private resolveLocalPath(
    currentFile: string,
    specifier: string,
  ): { path: string; isExternal: boolean } | null {
    const dir = path.dirname(currentFile);
    const fullPath = specifier.startsWith("/") ? specifier : path.resolve(dir, specifier);
    const isExternal = !fullPath.startsWith(this.rootDir);

    const extensions = [
      "",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".css",
      ".scss",
      ".sass",
      ".less",
      ".styl",
      ".coffee",
      ".ls",
      ".lua",
      ".feature",
    ];

    // ESM Support: If specifier ends with .js/.mjs/.cjs, try stripping it to allow .ts resolution
    const esmMatch = fullPath.match(/\.(js|mjs|cjs)$/);
    if (esmMatch) {
      const strippedPath = fullPath.slice(0, -esmMatch[0].length);
      for (const ext of [".ts", ".tsx"]) {
        const resolved = this.tryExtensions(strippedPath, ext, isExternal);
        if (resolved) return resolved;
      }
    }

    for (const ext of extensions) {
      const resolved = this.tryExtensions(fullPath, ext, isExternal);
      if (resolved) return resolved;
    }

    // Fallback for external absolute paths that couldn't be resolved with extensions
    return isExternal ? { path: fullPath, isExternal: true } : null;
  }

  /**
   * @description Checks whether `fullPath + ext` resolves to an existing file or an
   *   `index` file inside `fullPath` as a directory.
   * @param fullPath - The candidate path without extension.
   * @param ext - Extension to append, including the dot (e.g. `".ts"`), or empty string to try as-is.
   * @param isExternal - Whether the path falls outside the project root.
   * @returns Resolved path and external flag, or `null` if neither variant exists.
   */
  private tryExtensions(
    fullPath: string,
    ext: string,
    isExternal: boolean,
  ): { path: string; isExternal: boolean } | null {
    // Try file directly
    const p = fullPath + ext;
    if (this.isFile(p)) {
      return { path: p, isExternal };
    }

    // Try index file in directory
    const indexP = path.join(fullPath, `index${ext}`);
    if (this.isFile(indexP)) {
      return { path: indexP, isExternal };
    }

    return null;
  }

  /**
   * @description Safely checks whether a path refers to a regular file without throwing
   *   on missing entries or permission errors.
   * @param p - Absolute path to test.
   * @returns `true` if the path exists and is a regular file.
   */
  private isFile(p: string): boolean {
    try {
      const stats = fs.statSync(p, { throwIfNoEntry: false });
      return stats?.isFile() === true;
    } catch {
      return false;
    }
  }

  /**
   * @description Reads `tsconfig.json` from the project root and attempts to match the
   *   specifier against configured `compilerOptions.paths` aliases, trying each substitution
   *   with multiple extensions.
   * @param specifier - The import specifier to match against path aliases.
   * @returns Resolved path and external flag if an alias matches, or `null` otherwise.
   */
  private resolvePathAlias(specifier: string): { path: string; isExternal: boolean } | null {
    const tsconfigPath = path.join(this.rootDir, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) return null;

    try {
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
      const paths = tsconfig.compilerOptions?.paths;
      if (!paths) return null;

      for (const alias in paths) {
        const match = this.matchAliasPattern(alias, specifier);
        if (match) {
          const resolved = this.tryAliasSubstitutions(paths[alias], match[1] || "");
          if (resolved) return resolved;
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  private aliasRegexCache = new Map<string, RegExp>();

  /**
   * @description Converts a tsconfig path alias (e.g. `"@app/*"`) to a regex and tests it
   *   against the specifier, caching compiled regexes for repeated lookups.
   * @param alias - A tsconfig `paths` key, potentially containing a `*` wildcard.
   * @param specifier - The import specifier to test.
   * @returns The regex match array (including wildcard capture) if matched, or `null`.
   */
  private matchAliasPattern(alias: string, specifier: string): RegExpMatchArray | null {
    let regex = this.aliasRegexCache.get(alias);
    if (!regex) {
      const pattern = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\*", "(.*)");
      regex = new RegExp(`^${pattern}$`);
      this.aliasRegexCache.set(alias, regex);
    }
    return specifier.match(regex);
  }

  /**
   * @description Iterates over all substitution templates for a matched alias, replacing
   *   the `*` placeholder with the captured wildcard segment, then probing for an existing file.
   * @param substitutions - The array of path templates from tsconfig `paths` (e.g. `["src/app/*"]`).
   * @param wildcardMatch - The portion of the specifier that matched the `*` in the alias pattern.
   * @returns The first substitution that resolves to an existing file, or `null` if none match.
   */
  private tryAliasSubstitutions(
    substitutions: string[],
    wildcardMatch: string,
  ): { path: string; isExternal: boolean } | null {
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".coffee", ".ls", ".lua", ".feature"];

    for (const sub of substitutions) {
      const resolvedSub = sub.replace("*", wildcardMatch);
      const fullPath = path.resolve(this.rootDir, resolvedSub);

      for (const ext of extensions) {
        const resolved = this.tryExtensions(fullPath, ext, false);
        if (resolved) return resolved;
      }
    }
    return null;
  }
}
