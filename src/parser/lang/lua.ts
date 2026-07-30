/** Parses Lua source files via luaparse to extract require() dependency edges, module exports, and @tag annotations. */
import type { Chunk, Node, Statement } from "luaparse";
import luaparse from "luaparse";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
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
 * @description Collects the names of top-level local variables initialized as an empty (or any)
 *   table constructor — the conventional `local M = {}` module-table idiom — so that later
 *   assignments to `M.<field>` can be recognized as module exports.
 * @param topLevelStatements - Statements at the root of the chunk body.
 * @returns Set of identifier names bound to a table constructor at the top level.
 */
function collectModuleTableNames(topLevelStatements: Statement[]): Set<string> {
  const moduleTableNames = new Set<string>();
  for (const statement of topLevelStatements) {
    if (statement.type !== "LocalStatement") continue;
    statement.variables.forEach((variable, index) => {
      const initializer = statement.init[index];
      if (initializer?.type === "TableConstructorExpression") {
        moduleTableNames.add(variable.name);
      }
    });
  }
  return moduleTableNames;
}

/**
 * @description Extracts one export symbol per field of a `return { ... }` table literal, the
 *   other conventional Lua export idiom alongside the `local M = {}` module table.
 * @param topLevelStatements - Statements at the root of the chunk body.
 * @returns Export symbols named after each `TableKeyString` field in the trailing return table.
 */
function collectReturnTableExports(topLevelStatements: Statement[]): ExportedSymbol[] {
  const lastStatement = topLevelStatements[topLevelStatements.length - 1];
  if (lastStatement?.type !== "ReturnStatement") return [];
  const returnedTable = lastStatement.arguments[0];
  if (returnedTable?.type !== "TableConstructorExpression") return [];

  const exportedSymbols: ExportedSymbol[] = [];
  for (const field of returnedTable.fields) {
    if (field.type === "TableKeyString") exportedSymbols.push({ name: field.key.name });
  }
  return exportedSymbols;
}

/**
 * @description Walks the top-level chunk statements to collect Lua module exports: fields
 *   assigned onto a `local M = {}` module table (via `function M.foo()` or `M.foo = ...`),
 *   fields of a trailing `return { ... }` table literal, and non-local top-level function
 *   declarations (which are visible as Lua globals).
 * @param ast - The parsed luaparse AST root.
 * @returns One export symbol per discovered module member.
 */
function collectExports(ast: Chunk): ExportedSymbol[] {
  const topLevelStatements = ast.body;
  const moduleTableNames = collectModuleTableNames(topLevelStatements);
  const exportedSymbols: ExportedSymbol[] = collectReturnTableExports(topLevelStatements);

  for (const statement of topLevelStatements) {
    if (statement.type === "FunctionDeclaration") {
      if (statement.identifier?.type === "MemberExpression") {
        if (
          statement.identifier.base.type === "Identifier" &&
          moduleTableNames.has(statement.identifier.base.name)
        ) {
          exportedSymbols.push({ name: statement.identifier.identifier.name });
        }
      } else if (statement.identifier?.type === "Identifier" && !statement.isLocal) {
        exportedSymbols.push({ name: statement.identifier.name });
      }
    } else if (statement.type === "AssignmentStatement") {
      for (const variable of statement.variables) {
        if (
          variable.type === "MemberExpression" &&
          variable.base.type === "Identifier" &&
          moduleTableNames.has(variable.base.name)
        ) {
          exportedSymbols.push({ name: variable.identifier.name });
        }
      }
    }
  }

  const seenNames = new Set<string>();
  return exportedSymbols.filter((symbol) => {
    if (seenNames.has(symbol.name)) return false;
    seenNames.add(symbol.name);
    return true;
  });
}

/**
 * @description Parses a Lua source file using luaparse to extract `require()` dependency edges,
 *   module exports (the `local M = {}` / `return { ... }` idioms plus global function
 *   declarations), and `@tag` comment annotations. Falls back to empty imports/exports if the
 *   file contains syntax errors.
 * @param filePath - Path to the Lua file; used as the source on emitted edges and for test-file classification.
 * @param content - Raw Lua source text.
 * @returns Parsed imports, exports, extracted tags, and resolved category.
 */
export function parseLua(filePath: string, content: string): ParseResult {
  const tagNames = extractTagAnnotations(content);
  const category = classifyCategory(filePath, tagNames);

  let imports: ImportEdge[] = [];
  let exports: ExportedSymbol[] = [];
  try {
    const ast: Chunk = luaparse.parse(content);
    imports = collectRequireEdges(ast, filePath);
    exports = collectExports(ast);
  } catch (_parseError) {
    // Ignore parse errors
  }

  return {
    imports,
    exports,
    tags: Array.from(tagNames).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
