import type { Chunk, Node } from "luaparse";
import luaparse from "luaparse";
import type { ImportEdge } from "../types";
import { isStyleFile } from "./file-type";
import type { ParseResult } from "./types";

/**
 * Parses Lua files using luaparse for dependency extraction (require calls).
 */
export function parseLua(filePath: string, content: string): ParseResult {
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
    const ast: Chunk = luaparse.parse(content);

    function traverse(node: Node) {
      if (!node || typeof node !== "object") return;

      if (
        (node.type === "CallExpression" || node.type === "StringCallExpression") &&
        node.base?.type === "Identifier" &&
        node.base?.name === "require"
      ) {
        let specifier: string | undefined;
        if (node.type === "CallExpression") {
          const arg = node.arguments?.[0];
          if (arg?.type === "StringLiteral") {
            // raw is like "'module'" or '"module"'
            specifier = arg.raw.slice(1, -1);
          }
        } else if (node.type === "StringCallExpression") {
          const arg = node.argument;
          if (arg?.type === "StringLiteral") {
            specifier = arg.raw.slice(1, -1);
          }
        }

        if (specifier) {
          imports.push({
            fromPath: filePath,
            toPath: "",
            rawSpecifier: specifier,
            isStyle: isStyleFile(specifier),
            type: "require",
          });
        }
      }

      for (const key in node) {
        if (key === "loc") continue;
        const child = (node as unknown as Record<string, unknown>)[key];
        if (child && typeof child === "object") {
          if (Array.isArray(child)) {
            for (const c of child) traverse(c as Node);
          } else {
            traverse(child as Node);
          }
        }
      }
    }

    traverse(ast);
  } catch (_e) {
    // Ignore parse errors
  }

  return { imports, exports: [], tags: Array.from(tags), category };
}
