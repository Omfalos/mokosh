// @ts-expect-error
import ls from "livescript";
import type { ImportEdge } from "../types";
import { isStyleFile } from "./file-type";
import type { ParseResult } from "./types";

interface LiveScriptNode {
  constructor: { name: string };
  type?: string;
  right?: { value: string };
  head?: { value: string };
  tails?: Array<{
    constructor: { name: string };
    type?: string;
    args?: Array<{ value: string }>;
  }>;
  [key: string]: unknown;
}

/**
 * Parses LiveScript files using its AST for dependency extraction.
 */
export function parseLiveScript(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const tags: Set<string> = new Set();

  // Extract tags from comments
  const tagRegex = /@tag\s+([a-zA-Z0-9_-]+)/g;
  let match = tagRegex.exec(content);
  while (match !== null) {
    if (match[1]) tags.add(match[1]);
    match = tagRegex.exec(content);
  }

  const category =
    filePath.toLowerCase().includes(".test.") ||
    filePath.toLowerCase().includes(".spec.") ||
    tags.has("test")
      ? "test"
      : "logic";

  try {
    const ast = ls.ast(content) as LiveScriptNode;

    function traverse(node: LiveScriptNode) {
      if (!node || typeof node !== "object") return;

      const type = node.constructor?.name || node.type;

      if (type === "Import") {
        // ls import can be 'import "./a"' or 'import x from "./a"'
        // right side is the module specifier
        let specifier = node.right?.value;
        if (typeof specifier === "string") {
          if (specifier.startsWith("'") || specifier.startsWith('"')) {
            specifier = specifier.slice(1, -1);
          }
          imports.push({
            fromPath: filePath,
            toPath: "",
            rawSpecifier: specifier,
            isStyle: isStyleFile(specifier),
            type: "static",
          });
        }
      } else if (type === "Chain" && node.head?.value === "require") {
        const call = node.tails?.[0];
        if (call?.constructor?.name === "Call" || call?.type === "Call") {
          let specifier = call.args?.[0]?.value;
          if (typeof specifier === "string") {
            if (specifier.startsWith("'") || specifier.startsWith('"')) {
              specifier = specifier.slice(1, -1);
            }
            imports.push({
              fromPath: filePath,
              toPath: "",
              rawSpecifier: specifier,
              isStyle: isStyleFile(specifier),
              type: "require",
            });
          }
        }
      }

      for (const key in node) {
        if (
          key === "first_line" ||
          key === "first_column" ||
          key === "last_line" ||
          key === "last_column" ||
          key === "line" ||
          key === "column"
        )
          continue;
        const child = node[key];
        if (child && typeof child === "object") {
          if (Array.isArray(child)) {
            for (const c of child) traverse(c as LiveScriptNode);
          } else {
            traverse(child as LiveScriptNode);
          }
        }
      }
    }

    traverse(ast);
  } catch (_e) {
    // Fallback or ignore parse errors
  }

  return { imports, exports: [], tags: Array.from(tags), category };
}
