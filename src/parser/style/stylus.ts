import type { ImportEdge } from "../../types/node";

/**
 * @description Extracts all import edges from a Stylus file, covering both `@require` and bare `import`/`require` forms.
 * @param {string} content - Raw Stylus file contents
 * @param {string} filePath - Absolute path of the file; used as `fromPath` on each returned edge
 * @returns {ImportEdge[]} All import edges found, with `@require` entries typed as `"require"` and bare forms as `"static"`
 */
export function parseStylusImports(content: string, filePath: string): ImportEdge[] {
  const imports: ImportEdge[] = [];

  const atRequirePattern = /@require\s+['"]([^'"]+)['"]/g;
  let match = atRequirePattern.exec(content);
  while (match !== null) {
    const specifier = match[1];
    if (specifier) {
      imports.push({
        fromPath: filePath,
        toPath: "",
        rawSpecifier: specifier,
        isStyle: true,
        type: "require",
      });
    }
    match = atRequirePattern.exec(content);
  }

  // Negative lookbehind on @ avoids re-matching @require entries above
  const bareImportPattern = /(?<!@)(?:import|require)\s*\(?\s*['"]([^'"]+)['"]/g;
  match = bareImportPattern.exec(content);
  while (match !== null) {
    const specifier = match[1];
    if (specifier) {
      imports.push({
        fromPath: filePath,
        toPath: "",
        rawSpecifier: specifier,
        isStyle: true,
        type: "static",
      });
    }
    match = bareImportPattern.exec(content);
  }

  return imports;
}

// TODO(SOLID-I): only `imports.length` is read; parameter could be narrowed to `{ length: number }`
/**
 * @description Classifies a Stylus file as a barrel (re-exports only) or a UI file (contains rules or styles).
 *   Attempts AST analysis via the optional `stylus` library; falls back to regex stripping when unavailable.
 * @param {string} content - Raw Stylus file contents, used for both AST parsing and the regex fallback
 * @param {ImportEdge[]} imports - The edges already extracted from the file; only the count is used to short-circuit empty files
 * @returns {"ui" | "barrel"} `"barrel"` when the file contains only imports, `"ui"` when it also defines rules or styles
 */
export function detectStylusCategory(content: string, imports: ImportEdge[]): "ui" | "barrel" {
  if (imports.length === 0) return "ui";

  // Try Stylus AST for files using @require/@import (common form).
  // The Stylus Parser AST correctly identifies Import vs rule Group nodes.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stylusLib = require("stylus") as {
      Parser: new (src: string) => { parse(): { nodes: Array<{ constructor: { name: string } }> } };
    };
    const ast = new stylusLib.Parser(content).parse();
    const hasNonImport = ast.nodes.some((n) => n.constructor.name !== "Import");
    return hasNonImport ? "ui" : "barrel";
  } catch {
    // Fallback: strip all import/require lines and check if any content remains.
    // Handles bare `import 'path'`, `require('path')`, and `@require 'path'` forms.
    const withoutImports = content.replace(/^\s*@?(?:require|import)\b.*/gm, "").trim();
    return withoutImports.length > 0 ? "ui" : "barrel";
  }
}
