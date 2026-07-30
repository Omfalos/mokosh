/** Parses SCSS/Sass files using postcss-scss to extract @use, @forward, and @import edges, plus root-level variable/mixin/function exports. */
import type postcss from "postcss";
import { parse as scssParse } from "postcss-scss";
import type { ExportedSymbol, ImportEdge, StructuredTag } from "../../types/node";

/**
 * @description Returns true when a Sass identifier follows the module-privacy convention
 *   (leading `_` or `-`), meaning it is never visible outside the file via `@use` and so is
 *   not part of the module's exported surface.
 * @param {string} name - The variable, mixin, or function name (without its `$` sigil, if any)
 * @returns {boolean} `true` for private names
 */
function isScssPrivateName(name: string): boolean {
  return name.startsWith("_") || name.startsWith("-");
}

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
 * @description Walks the root-level nodes of a parsed SCSS AST and collects `$variable` declarations
 *   and `@mixin`/`@function` at-rules as the file's exported surface, mirroring how `export` works in TS.
 *   Skips Sass-private names (leading `_`/`-`), which are never visible outside the file via `@use`,
 *   and skips anything not declared directly at the root (rule- or mixin-body-scoped declarations are local).
 * @param {postcss.Root} root - The parsed SCSS AST
 * @returns {{ exports: ExportedSymbol[]; tags: StructuredTag[] }} Root-level variable/mixin/function exports and their matching declaration tags
 */
function extractScssExports(root: postcss.Root): {
  exports: ExportedSymbol[];
  tags: StructuredTag[];
} {
  const exports: ExportedSymbol[] = [];
  const tags: StructuredTag[] = [];

  for (const node of root.nodes ?? []) {
    if (node.type === "decl" && node.prop.startsWith("$")) {
      const name = node.prop.slice(1);
      if (!name || isScssPrivateName(name)) continue;
      exports.push({ name });
      tags.push({ name, kind: "variable" });
      continue;
    }

    if (node.type === "atrule" && (node.name === "mixin" || node.name === "function")) {
      const match = node.params.match(/^([\w-]+)/);
      const name = match?.[1];
      if (!name || isScssPrivateName(name)) continue;
      const signature = node.params.trim();
      exports.push(signature.includes("(") ? { name, signature } : { name });
      tags.push({ name, kind: "function" });
    }
  }

  return { exports, tags };
}

/**
 * @description Parses a SCSS file and returns its import edges alongside the PostCSS AST.
 *   Recognises `@import`, `@use`, and `@forward` at-rules; marks `@forward` edges as `re-export` and attaches namespace aliases when an `as` clause is present.
 *   Also extracts root-level `$variable`/`@mixin`/`@function` declarations as the file's exports and matching declaration tags.
 * @param {string} content - Raw SCSS file contents
 * @param {string} filePath - Absolute path of the file; used as `fromPath` on each returned edge
 * @returns {{ imports: ImportEdge[]; root: postcss.Root; exports: ExportedSymbol[]; tags: StructuredTag[] }} The collected import edges, the PostCSS root (used for barrel detection), and the file's exported surface
 */
export function parseScssContent(
  content: string,
  filePath: string,
): { imports: ImportEdge[]; root: postcss.Root; exports: ExportedSymbol[]; tags: StructuredTag[] } {
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

  const { exports, tags } = extractScssExports(root);
  return { imports, root, exports, tags };
}
