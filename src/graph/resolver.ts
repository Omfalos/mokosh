import fs from "node:fs";
import path from "node:path";

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
  resolve(currentFile: string, specifier: string): ResolvedImport | null;
}

/** @description Configuration options for `DefaultResolver`, used to support monorepo and alias-aware resolution. */
export interface ResolverOptions {
  /**
   * Maps workspace package names to their absolute root directories.
   * When set, matching specifiers are resolved as internal workspace imports
   * rather than external npm packages.
   */
  workspaceMap?: Map<string, string>;
  /**
   * Ordered list of directories to search for `tsconfig.json` when resolving
   * path aliases. Defaults to `[rootDir]`. For monorepo builds, pass
   * `[packageRoot, monorepoRoot]` so per-package aliases take precedence.
   */
  tsconfigSearchPaths?: string[];
}

/**
 * @description Default import resolver that handles relative paths, absolute paths,
 *   tsconfig path aliases, workspace packages, Lua dot-separated modules, and external node_modules.
 */
export class DefaultResolver implements PathResolver {
  private readonly workspaceMap: Map<string, string>;
  private readonly tsconfigSearchPaths: string[];

  /**
   * @param rootDir - Absolute path to the project root, used as the boundary for
   *   deciding whether a resolved path is internal or external.
   * @param options - Optional workspace map and tsconfig search paths for monorepo builds.
   */
  constructor(
    private rootDir: string,
    options: ResolverOptions = {},
  ) {
    this.workspaceMap = options.workspaceMap ?? new Map();
    this.tsconfigSearchPaths = options.tsconfigSearchPaths ?? [rootDir];
  }

  /**
   * @description Resolves a specifier by trying path aliases first, then relative/absolute
   *   local paths, then Lua dot-notation, and finally treating the specifier as an external module.
   * @param currentFile - Absolute path of the file containing the import.
   * @param specifier - The raw import specifier to resolve.
   * @returns Resolved path and external flag, or `null` if no local file can be found.
   */
  public resolve(currentFile: string, specifier: string): ResolvedImport | null {
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

    // 4. Python bare module names: try local .py files before marking external
    if (currentFile.endsWith(".py")) {
      const local = this.resolvePythonBareImport(specifier);
      if (local) return local;
    }

    // 5. Workspace package resolution — check before falling through to external
    const workspace = this.resolveWorkspaceImport(specifier);
    if (workspace) return workspace;

    // 6. Non-relative, non-absolute import (likely a node_module or built-in)
    return { path: specifier, isExternal: true };
  }

  /**
   * @description Resolves a relative or absolute specifier to a concrete file path by
   *   trying multiple extensions and index-file fallbacks, including ESM `.js`→`.ts` rewriting.
   * @param currentFile - Absolute path of the importing file, used to compute the base directory.
   * @param specifier - A relative (`./foo`) or absolute (`/foo`) import specifier.
   * @returns Resolved path and external flag, or `null` if no matching file is found within the project.
   */
  private resolveLocalPath(currentFile: string, specifier: string): ResolvedImport | null {
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
      ".py",
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
  private tryExtensions(fullPath: string, ext: string, isExternal: boolean): ResolvedImport | null {
    // Try file directly
    const p = fullPath + ext;
    if (this.isFile(p)) {
      return { path: p, isExternal };
    }

    // Try index file in directory (JS/TS convention: index.ts)
    const indexP = path.join(fullPath, `index${ext}`);
    if (this.isFile(indexP)) {
      return { path: indexP, isExternal };
    }

    // Python convention: __init__.py for packages
    if (ext === ".py") {
      const initP = path.join(fullPath, "__init__.py");
      if (this.isFile(initP)) {
        return { path: initP, isExternal };
      }
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
  private resolvePathAlias(specifier: string): ResolvedImport | null {
    for (const searchDir of this.tsconfigSearchPaths) {
      const tsconfigPath = path.join(searchDir, "tsconfig.json");
      if (!fs.existsSync(tsconfigPath)) continue;

      try {
        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
        const paths = tsconfig.compilerOptions?.paths;
        if (!paths) continue;

        for (const alias in paths) {
          const match = this.matchAliasPattern(alias, specifier);
          if (match) {
            const resolved = this.tryAliasSubstitutions(paths[alias], match[1] || "", searchDir);
            if (resolved) return resolved;
          }
        }
      } catch {
        // Ignore parse errors
      }
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
    baseDir: string = this.rootDir,
  ): ResolvedImport | null {
    const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".coffee", ".ls", ".lua", ".feature"];

    for (const sub of substitutions) {
      const resolvedSub = sub.replace("*", wildcardMatch);
      const fullPath = path.resolve(baseDir, resolvedSub);

      for (const ext of extensions) {
        const resolved = this.tryExtensions(fullPath, ext, false);
        if (resolved) return resolved;
      }
    }
    return null;
  }

  /**
   * @description Resolves a specifier against the workspace package map. Handles exact
   *   package name matches and deep imports (`@myorg/shared/utils`). Resolved paths are
   *   marked `isExternal: false` and `isWorkspace: true` so the builder treats them as
   *   internal cross-package edges rather than npm dependencies.
   * @param {string} specifier - The raw import specifier to match against workspace package names.
   * @returns {ResolvedImport | null} Resolved path with workspace flags, or `null` if no package matches.
   */
  private resolveWorkspaceImport(specifier: string): ResolvedImport | null {
    if (this.workspaceMap.size === 0) return null;

    for (const [pkgName, pkgRoot] of this.workspaceMap) {
      if (specifier !== pkgName && !specifier.startsWith(`${pkgName}/`)) continue;

      const subPath = specifier.slice(pkgName.length); // "" or "/deep/path"
      const base: ResolvedImport = {
        path: "",
        isExternal: false,
        isWorkspace: true,
        workspacePackage: pkgName,
      };

      if (!subPath) {
        // Resolve to package entry — try common conventions
        for (const candidate of [
          "src/index.ts",
          "src/index.tsx",
          "index.ts",
          "index.tsx",
          "index.js",
        ]) {
          const abs = path.join(pkgRoot, candidate);
          try {
            if (fs.statSync(abs, { throwIfNoEntry: false })?.isFile()) {
              return { ...base, path: abs };
            }
          } catch {
            /* skip */
          }
        }
        // Fallback: package root itself (builder will handle gracefully)
        return { ...base, path: pkgRoot };
      }

      // Deep import: resolve subPath relative to pkgRoot
      const deepResolved = this.resolveLocalPath(path.join(pkgRoot, "_dummy"), subPath.slice(1));
      if (deepResolved) return { ...base, path: deepResolved.path };

      return null;
    }

    return null;
  }

  /**
   * @description Tries to resolve a bare Python module name (e.g. `mymodule` or `mypackage.sub`)
   *   to a local `.py` file or package `__init__.py` inside the project root.
   *   Dots in the specifier are treated as path separators. Returns `null` if no local file is
   *   found — the caller then falls through to marking the import as external.
   * @param {string} specifier - The bare module name as it appears in the source (e.g. `"os.path"`).
   * @returns {ResolvedImport | null} Resolved local file path, or `null` if no match is found.
   */
  private resolvePythonBareImport(specifier: string): ResolvedImport | null {
    const pyPath = specifier.replace(/\./g, path.sep);

    // Try as a .py file or package (__init__.py) relative to the project root.
    for (const base of [this.rootDir]) {
      const pyFile = path.join(base, pyPath + ".py");
      if (this.isFile(pyFile)) {
        return { path: pyFile, isExternal: false };
      }
      const initFile = path.join(base, pyPath, "__init__.py");
      if (this.isFile(initFile)) {
        return { path: initFile, isExternal: false };
      }
    }

    return null;
  }
}
