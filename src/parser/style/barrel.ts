import type postcss from "postcss";
import type { ImportEdge, NodeCategory } from "../../types";

// TODO(SOLID-I): only `imports.length` is read; parameter could be narrowed to `{ length: number }`
/**
 * Classifies a CSS or Less file as a barrel (imports only) or a UI file (contains CSS rules).
 *
 * @param root - The PostCSS AST of the parsed file; walked to detect any `rule` nodes
 * @param imports - The edges already extracted from the file; only the count is used to short-circuit empty files
 * @returns `"barrel"` when the file has imports but no CSS rules, `"ui"` otherwise
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
