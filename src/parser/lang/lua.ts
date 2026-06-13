/** Parses Lua source files via luaparse to extract require() dependency edges and @tag annotations. */
import type { Chunk, Node } from "luaparse";
import luaparse from "luaparse";
import type { ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";
import { stripQuotes } from "../utils";

/**
 * @description Parses a Lua source file using luaparse to extract `require()` dependency edges
 *   and `@tag` comment annotations. Falls back to an empty import list if the file contains
 *   syntax errors.
 * @param filePath - Path to the Lua file; used as the source on emitted edges and for test-file classification.
 * @param content - Raw Lua source text.
 * @returns Parsed imports, empty exports list, extracted tags, and resolved category.
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

    /**
     * @description Recursively walks a luaparse AST node, pushing a `require()` edge into
     *   `imports` for every matching call expression found. Skips `loc` keys to avoid
     *   processing location metadata objects.
     * @param node - The AST node to walk.
     */
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
            specifier = stripQuotes(arg.raw);
          }
        } else if (node.type === "StringCallExpression") {
          const arg = node.argument;
          if (arg?.type === "StringLiteral") {
            specifier = stripQuotes(arg.raw);
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

  return {
    imports,
    exports: [],
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
