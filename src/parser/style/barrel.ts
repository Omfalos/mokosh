/** Classifies CSS/Less files as barrels (import-only) or UI files based on PostCSS AST analysis. */
import type postcss from "postcss";
import type { ImportEdge } from "../../types/node";
import type { NodeCategory } from "../../types/parse";

// TODO(SOLID-I): only `imports.length` is read; parameter could be narrowed to `{ length: number }`
/**
 * @description Classifies a CSS or Less file as a barrel (imports only) or a UI file (contains CSS rules).
 * @param {postcss.Root} root - The PostCSS AST of the parsed file; walked to detect any `rule` nodes
 * @param {ImportEdge[]} imports - The edges already extracted from the file; only the count is used to short-circuit empty files
 * @returns {NodeCategory} `"barrel"` when the file has imports but no CSS rules, `"ui"` otherwise
 */
export function detectCssBarrel(root: postcss.Root, imports: ImportEdge[]): NodeCategory {
  if (imports.length === 0) return "ui";
  let hasRule = false;
  root.walk((node) => {
    if (node.type === "rule") {
      hasRule = true;
      return false;
    }
  });
  return hasRule ? "ui" : "barrel";
}
