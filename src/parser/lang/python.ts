/** Parses Python source files using the Lezer parser to extract import edges, exports, and tag annotations. */
import path from "node:path";
import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/python";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import type { ParseResult } from "../types";

const TEST_LIBS = new Set(["pytest", "unittest", "nose", "hypothesis"]);

/**
 * @description Parses a Python source file using the Lezer parser to extract import edges,
 *   top-level definitions as exports, `# @tag` comment markers, and file category.
 * @param {string} filePath - Path to the `.py` file; used for test-file classification by basename convention.
 * @param {string} content - Raw Python source text.
 * @returns {ParseResult} Parsed imports, top-level exports, comment-marker tags, and resolved category.
 */
export function parsePython(filePath: string, content: string): ParseResult {
  const imports: ImportEdge[] = [];
  const exports: ExportedSymbol[] = [];
  const tags = new Set<string>();
  const baseName = path.basename(filePath).toLowerCase();

  const tree = parser.parse(content);
  const cursor = tree.cursor();

  do {
    switch (cursor.name) {
      case "Comment": {
        const tagMatch = content.slice(cursor.from, cursor.to).match(/#\s*@tag\s+([a-zA-Z0-9_-]+)/);
        if (tagMatch?.[1]) tags.add(tagMatch[1]);
        break;
      }
      case "ImportStatement": {
        for (const edge of extractImportEdges(cursor.node, content, filePath)) {
          imports.push(edge);
        }
        break;
      }
      case "FunctionDefinition":
      case "ClassDefinition": {
        // Only top-level — parent must be Script or a DecoratedStatement directly under Script
        const parentNode = cursor.node.parent;
        const isTopLevel =
          parentNode?.name === "Script" ||
          (parentNode?.name === "DecoratedStatement" && parentNode.parent?.name === "Script");
        if (isTopLevel) {
          const nameNode = cursor.node.getChild("VariableName");
          if (nameNode) exports.push({ name: content.slice(nameNode.from, nameNode.to) });
        }
        break;
      }

      case "AssignStatement": {
        // Only top-level simple assignments: `MY_VAR = value`
        if (cursor.node.parent?.name === "Script") {
          const target = cursor.node.firstChild;
          if (target?.name === "VariableName") {
            exports.push({ name: content.slice(target.from, target.to) });
          }
        }
        break;
      }
    }
  } while (cursor.next());

  const category = resolveCategory(baseName, imports, tags);
  if (category === "test") tags.add("test");

  return {
    imports,
    exports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}

// ─── import edge extraction ───────────────────────────────────────────────────

/**
 * @description Dispatches a single Lezer `ImportStatement` node to the appropriate extractor
 *   based on whether it begins with `from` (from-import form) or not (bare import form).
 * @param {SyntaxNode} node - The `ImportStatement` AST node to process.
 * @param {string} src - Full source text, used to slice node ranges into strings.
 * @param {string} filePath - Source file path stamped onto each emitted edge.
 * @returns {ImportEdge[]} One or more import edges extracted from the statement.
 */
function extractImportEdges(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const first = node.firstChild;
  if (!first) return [];
  return first.name === "from"
    ? extractFromImport(node, src, filePath)
    : extractBareImport(node, src, filePath);
}

/**
 * Handles `from <module> import <names>` in all forms:
 *   absolute, relative (. / .. / ...), dotted module paths, star, aliases.
 */
function extractFromImport(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const fromKw = node.firstChild;
  if (!fromKw) return [];

  // Find the `import` keyword that splits module from names
  let importKw: SyntaxNode | null = fromKw.nextSibling;
  while (importKw && importKw.name !== "import") importKw = importKw.nextSibling;
  if (!importKw) return [];

  // Raw module text: everything between `from` end and `import` start.
  // e.g. " .models", " os.path", " .. ", " ...core.utils"
  const rawModule = src.slice(fromKw.to, importKw.from).trim();
  const importedNames = collectImportedNames(importKw.nextSibling, src);
  if (!importedNames.length) return [];

  // Split leading dots from the rest of the module path
  let dotCount = 0;
  while (dotCount < rawModule.length && rawModule[dotCount] === ".") dotCount++;
  const modulePart = rawModule.slice(dotCount); // e.g. "models", "core.utils", ""

  if (dotCount === 0) {
    // Absolute import: `from pathlib import Path`
    // Keep dotted module name as-is; resolver converts dots → path separators.
    return [makeEdge(filePath, rawModule, importedNames, true)];
  }

  // n=1 → "./"  (current package)
  // n=2 → "../" (parent package)
  // n=3 → "../../" (grandparent)
  const prefix = dotCount === 1 ? "./" : "../".repeat(dotCount - 1);

  if (!modulePart) {
    // `from . import utils, models` — each name is its own sub-module.
    // `from . import *`            — edge to the package init.
    if (importedNames[0] === "*") {
      return [makeEdge(filePath, prefix.slice(0, -1), ["*"], false)];
    }
    return importedNames.map((name) => makeEdge(filePath, prefix + name, [name], false));
  }

  // `from .models import User` → "./models"
  // `from .models.user import X` → "./models/user"
  return [makeEdge(filePath, prefix + modulePart.replace(/\./g, "/"), importedNames, false)];
}

/**
 * Handles `import <module>` statements, including dotted paths and aliases.
 * `import os, sys` produces two edges; `import os.path as p` uses the original module name.
 */
function extractBareImport(node: SyntaxNode, src: string, filePath: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  let childNode: SyntaxNode | null = node.firstChild?.nextSibling ?? null; // skip "import" keyword

  while (childNode) {
    if (childNode.name === "VariableName") {
      // Collect possibly dotted module name: os + . + path → "os.path"
      let modName = src.slice(childNode.from, childNode.to);
      while (
        childNode.nextSibling?.name === "." &&
        childNode.nextSibling.nextSibling?.name === "VariableName"
      ) {
        childNode = childNode.nextSibling.nextSibling as SyntaxNode;
        modName += `.${src.slice(childNode.from, childNode.to)}`;
      }
      // Skip optional `as alias`
      if (childNode.nextSibling?.name === "as") {
        childNode = childNode.nextSibling.nextSibling ?? childNode.nextSibling;
      }
      edges.push(makeEdge(filePath, modName, ["*"], true));
    }
    childNode = childNode.nextSibling;
  }

  return edges;
}

/**
 * Walks the sibling chain after `import`, collecting symbol names and skipping `as` aliases.
 */
function collectImportedNames(start: SyntaxNode | null, src: string): string[] {
  const names: string[] = [];
  let childNode: SyntaxNode | null = start;
  while (childNode) {
    if (childNode.name === "*") {
      names.push("*");
    } else if (childNode.name === "VariableName") {
      names.push(src.slice(childNode.from, childNode.to));
      // Skip `as alias` if present
      if (childNode.nextSibling?.name === "as") {
        childNode = childNode.nextSibling.nextSibling ?? childNode.nextSibling;
      }
    }
    childNode = childNode.nextSibling;
  }
  return names;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEdge(
  filePath: string,
  rawSpecifier: string,
  symbols: string[],
  isExternal: boolean,
): ImportEdge {
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier,
    isStyle: false,
    isExternal,
    type: "static",
    symbols: symbols.length > 0 ? symbols : undefined,
  };
}

/**
 * @description Classifies a Python file as `"test"`, `"config"`, or `"logic"` based on
 *   its basename convention, imports from known test libraries, and explicit `@tag test` markers.
 * @param {string} baseName - Lowercase basename of the file, e.g. `"test_auth.py"`.
 * @param {ImportEdge[]} imports - Resolved import edges used to detect test-library usage.
 * @param {Set<string>} tags - Tag names extracted from comments.
 * @returns {"test" | "config" | "logic"} The resolved category for this file.
 */
function resolveCategory(
  baseName: string,
  imports: ImportEdge[],
  tags: Set<string>,
): "test" | "config" | "logic" {
  if (baseName.startsWith("test_") || baseName.endsWith("_test.py")) return "test";
  if (baseName === "conftest.py" || baseName === "setup.py") return "config";
  if (tags.has("test")) return "test";
  if (imports.some((imp) => TEST_LIBS.has(imp.rawSpecifier))) return "test";
  return "logic";
}
