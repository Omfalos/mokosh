/** Parses Lua source files via luaparse to extract require() dependency edges and @tag annotations. */
import type { Chunk, Node } from "luaparse";
import luaparse from "luaparse";
import type { ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";
import { stripQuotes } from "../utils";

/**
 * @description Extracts `@tag <name>` comment annotations from raw Lua source text.
 * @param {string} content - Raw Lua source text.
 * @returns {Set<string>} The set of distinct tag names found in `content`.
 */
function extractTagAnnotations(content: string): Set<string> {
  const tagNames = new Set<string>();
  const tagAnnotationRegex = /@tag\s+([a-zA-Z0-9_-]+)/g;
  let annotationMatch = tagAnnotationRegex.exec(content);
  while (annotationMatch !== null) {
    if (annotationMatch[1]) tagNames.add(annotationMatch[1]);
    annotationMatch = tagAnnotationRegex.exec(content);
  }
  return tagNames;
}

/**
 * @description Classifies a Lua file as `"test"` or `"logic"` based on its filename
 *   (`.test.` / `.spec.` substrings) or the presence of an explicit `@tag test` annotation.
 * @param {string} filePath - Path to the Lua file.
 * @param {Set<string>} tagNames - Tag names already extracted from the file's comments.
 * @returns {"test" | "logic"} The resolved file category.
 */
function classifyCategory(filePath: string, tagNames: Set<string>): "test" | "logic" {
  const lowerCasePath = filePath.toLowerCase();
  const isTest =
    lowerCasePath.includes(".test.") || lowerCasePath.includes(".spec.") || tagNames.has("test");
  return isTest ? "test" : "logic";
}

/**
 * @description Recursively walks a luaparse AST and returns a `require()` dependency edge for
 *   every matching call expression found. Skips `loc` keys to avoid processing location
 *   metadata objects.
 * @param {Chunk} ast - The parsed luaparse AST root.
 * @param {string} filePath - Path to the Lua file; used as `fromPath` on emitted edges.
 * @returns {ImportEdge[]} One edge per `require()` call found with a string-literal argument.
 */
function collectRequireEdges(ast: Chunk, filePath: string): ImportEdge[] {
  const importEdges: ImportEdge[] = [];

  function visitNode(node: Node) {
    if (!node || typeof node !== "object") return;

    if (
      (node.type === "CallExpression" || node.type === "StringCallExpression") &&
      node.base?.type === "Identifier" &&
      node.base?.name === "require"
    ) {
      let specifier: string | undefined;
      if (node.type === "CallExpression") {
        const requireArgument = node.arguments?.[0];
        if (requireArgument?.type === "StringLiteral") {
          // raw is like "'module'" or '"module"'
          specifier = stripQuotes(requireArgument.raw);
        }
      } else if (node.type === "StringCallExpression") {
        const requireArgument = node.argument;
        if (requireArgument?.type === "StringLiteral") {
          specifier = stripQuotes(requireArgument.raw);
        }
      }

      if (specifier) {
        importEdges.push({
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
      const childValue = (node as unknown as Record<string, unknown>)[key];
      if (childValue && typeof childValue === "object") {
        if (Array.isArray(childValue)) {
          for (const childNode of childValue) visitNode(childNode as Node);
        } else {
          visitNode(childValue as Node);
        }
      }
    }
  }

  visitNode(ast);
  return importEdges;
}

/**
 * @description Parses a Lua source file using luaparse to extract `require()` dependency edges
 *   and `@tag` comment annotations. Falls back to an empty import list if the file contains
 *   syntax errors.
 * @param filePath - Path to the Lua file; used as the source on emitted edges and for test-file classification.
 * @param content - Raw Lua source text.
 * @returns Parsed imports, empty exports list, extracted tags, and resolved category.
 */
export function parseLua(filePath: string, content: string): ParseResult {
  const tagNames = extractTagAnnotations(content);
  const category = classifyCategory(filePath, tagNames);

  let imports: ImportEdge[] = [];
  try {
    const ast: Chunk = luaparse.parse(content);
    imports = collectRequireEdges(ast, filePath);
  } catch (_parseError) {
    // Ignore parse errors
  }

  return {
    imports,
    exports: [],
    tags: Array.from(tagNames).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
