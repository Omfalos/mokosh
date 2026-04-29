import fs from "node:fs";
import path from "node:path";

export interface PathResolver {
  resolve(currentFile: string, specifier: string): { path: string; isExternal: boolean } | null;
}

export class DefaultResolver implements PathResolver {
  constructor(private rootDir: string) {}

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

  private isFile(p: string): boolean {
    try {
      const stats = fs.statSync(p, { throwIfNoEntry: false });
      return stats?.isFile() === true;
    } catch {
      return false;
    }
  }

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

  private matchAliasPattern(alias: string, specifier: string): RegExpMatchArray | null {
    let regex = this.aliasRegexCache.get(alias);
    if (!regex) {
      const pattern = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\*", "(.*)");
      regex = new RegExp(`^${pattern}$`);
      this.aliasRegexCache.set(alias, regex);
    }
    return specifier.match(regex);
  }

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
