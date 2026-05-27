import type postcss from "postcss";
import { parse as scssParse } from "postcss-scss";
import type { ImportEdge } from "../../types/node";

/**
 * @description Returns true when a SCSS/Sass import specifier resolves outside the local file tree.
 * @param {string} specifier - The raw import path as written in source (e.g. `sass:color`, `~bootstrap`, `./tokens`)
 * @returns {boolean} `true` for built-in Sass namespaces, tilde node_modules shortcuts, HTTP/protocol-relative URLs, and bare package names
 */
function isScssExternal(specifier: string): boolean {
  // Built-in Sass namespaces (sass:color, sass:math, etc.)
  if (specifier.startsWith("sass:")) return true;
  // Webpack/Less tilde convention for node_modules
  if (specifier.startsWith("~")) return true;
  // HTTP/protocol-relative URLs
  if (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("//")
  )
    return true;
  // Bare package name: no leading `.`, `/`, or `_` (Sass partial convention)
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("_"))
    return true;
  return false;
}

/**
 * @description Extracts the import path and optional namespace alias from a SCSS `@use` or `@forward` params string.
 * @param {string} params - The raw text after the at-rule keyword (e.g. `"./tokens" as t`)
 * @returns {{ specifier: string; alias?: string }} The resolved specifier and, when an `as` clause is present, the alias name
 */
function parseScssParams(params: string): { specifier: string; alias?: string } {
  const specMatch = params.match(/^['"]([^'"]+)['"]/);
  if (!specMatch?.[1]) return { specifier: "" };
  const specifier = specMatch[1];
  const asMatch = params.match(/\bas\s+(\S+)/);
  const alias = asMatch?.[1];
  return alias !== undefined ? { specifier, alias } : { specifier };
}

/**
 * @description Parses a SCSS file and returns its import edges alongside the PostCSS AST.
 *   Recognises `@import`, `@use`, and `@forward` at-rules; marks `@forward` edges as `re-export` and attaches namespace aliases when an `as` clause is present.
 * @param {string} content - Raw SCSS file contents
 * @param {string} filePath - Absolute path of the file; used as `fromPath` on each returned edge
 * @returns {{ imports: ImportEdge[]; root: postcss.Root }} The collected import edges and the PostCSS root, which callers use for barrel detection
 */
export function parseScssContent(
  content: string,
  filePath: string,
): { imports: ImportEdge[]; root: postcss.Root } {
  const root = scssParse(content) as postcss.Root;
  const imports: ImportEdge[] = [];

  root.walk((node) => {
    if (node.type !== "atrule") return;
    const { name, params } = node;
    if (name !== "import" && name !== "use" && name !== "forward") return;

    const { specifier, alias } = parseScssParams(params);
    if (!specifier) return;

    const edge: ImportEdge = {
      fromPath: filePath,
      toPath: "",
      rawSpecifier: specifier,
      isStyle: true,
      type: name === "forward" ? "re-export" : "static",
      ...(isScssExternal(specifier) ? { isExternal: true } : {}),
    };
    if (alias) edge.symbols = [alias];
    imports.push(edge);
  });

  return { imports, root };
}
