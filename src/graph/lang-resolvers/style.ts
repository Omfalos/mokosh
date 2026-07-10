/** Language resolver for style dialects: resolves bare `@import`/`@require`/`@use` specifiers relative to the importing file. */
import path from "node:path";
import type { LangResolver, ResolvedImport } from "./types";

const EXTERNAL_PREFIXES = ["~", "http://", "https://", "//", "data:", "sass:"];

/**
 * @description Resolves bare style import specifiers (e.g. `@import 'variables'` in Sass/Less/Stylus,
 *   which by convention means "same directory", unlike JS bare specifiers which mean "node_modules").
 *   Also tries the Sass/SCSS partial-file convention (`variables` → `_variables.scss`).
 */
export class StyleLangResolver implements LangResolver {
  extensions = [".css", ".scss", ".sass", ".less", ".styl"];

  /**
   * @description Treats a bare specifier as relative to the importing file's directory, then
   *   falls back to the Sass/SCSS underscore-partial convention before giving up.
   * @param {string} currentFile - Absolute path of the importing style file.
   * @param {string} specifier - The raw bare specifier from source, e.g. `"variables"`.
   * @param {string} _rootDir - Absolute project root (unused; resolution is directory-relative).
   * @param {Function} resolveLocal - Generic resolver callback for extension and index-file probing.
   * @returns {ResolvedImport[] | null} The resolved local file, or `null` to fall through to external.
   */
  resolve(
    currentFile: string,
    specifier: string,
    _rootDir: string,
    resolveLocal: (currentFile: string, specifier: string) => ResolvedImport | null,
  ): ResolvedImport[] | null {
    if (EXTERNAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) return null;

    const resolved = resolveLocal(currentFile, specifier);
    if (resolved) return [resolved];

    const dir = path.dirname(specifier);
    const base = path.basename(specifier);
    const partialSpecifier = dir === "." ? `_${base}` : `${dir}/_${base}`;
    const partialResolved = resolveLocal(currentFile, partialSpecifier);
    if (partialResolved) return [partialResolved];

    return null;
  }
}
