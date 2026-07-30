/** Parses CoffeeScript files to extract import edges, module exports, and tag annotations. */
import coffee from "coffeescript";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";
import { stripQuotes } from "../utils";

interface StringLiteralNode {
  value: string;
  originalValue?: string;
}

interface CoffeeNode {
  constructor: { name: string };
  source?: StringLiteralNode;
  variable?: CoffeeNode & { base?: CoffeeNode; properties?: CoffeeNode[] };
  args?: Array<{ base?: StringLiteralNode }>;
  value?: unknown;
  base?: CoffeeNode;
  properties?: CoffeeNode[];
  name?: CoffeeNode;
  clause?: CoffeeNode;
  specifiers?: Array<{ identifier?: string; original?: { value?: string } }>;
  [key: string]: unknown;
}

/**
 * @description Resolves the unquoted text of a CoffeeScript string-literal node. Prefers
 *   `originalValue` (the compiler's own unescaped/unquoted form) and falls back to stripping
 *   the surrounding quote characters from `.value` when `originalValue` isn't present.
 * @param node - The string-literal AST node, or `undefined`.
 * @returns The unquoted string content, or `undefined` if `node` has no string value.
 */
function stringLiteralValue(node: StringLiteralNode | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.originalValue === "string") return node.originalValue;
  if (typeof node.value === "string") return stripQuotes(node.value);
  return undefined;
}

/**
 * @description Resolves the plain identifier name held by a CoffeeScript AST node, handling both
 *   bare `IdentifierLiteral` nodes (`.value`) and `Value`-wrapped identifiers (`.base.value`) used
 *   as the LHS of assignments and export clauses.
 * @param node - The AST node to resolve, or `undefined`.
 * @returns The identifier's string name, or `undefined` if `node` isn't a simple identifier.
 */
function identifierName(node: CoffeeNode | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.value === "string") return node.value;
  if (typeof node.base?.value === "string") return node.base.value;
  return undefined;
}

/**
 * @description Scans raw source text for `@tag <name>` comment annotations and collects
 *   the tag names. Runs before category resolution so `@tag test` can influence classification.
 * @param content - Raw source text to scan.
 * @returns Set of tag name strings found in `@tag` annotations.
 */
function extractTags(content: string): Set<string> {
  const tags = new Set<string>();
  const tagRegex = /@tag\s+([a-zA-Z0-9_-]+)/g;
  let match = tagRegex.exec(content);
  while (match !== null) {
    if (match[1]) tags.add(match[1]);
    match = tagRegex.exec(content);
  }
  return tags;
}

/**
 * @description Determines whether a file is a test or production-logic file by checking
 *   path naming conventions (`.test.`, `.spec.`) and explicit `@tag test` annotations.
 * @param filePath - Path to the file being classified.
 * @param tags - Tag names extracted from the file's content.
 * @returns `"test"` if the file is a test file, `"logic"` otherwise.
 */
function resolveCategory(filePath: string, tags: Set<string>): "test" | "logic" {
  const lower = filePath.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.") || tags.has("test")) {
    return "test";
  }
  return "logic";
}

/**
 * @description Builds an `ImportEdge` from a CoffeeScript static `import` declaration AST node.
 * @param filePath - Source file path stamped onto the edge.
 * @param node - CoffeeScript AST node representing an `ImportDeclaration`.
 * @returns An `ImportEdge` for the import, or `null` if the node carries no source value.
 */
function edgeFromImportDeclaration(filePath: string, node: CoffeeNode): ImportEdge | null {
  const specifier = stringLiteralValue(node.source);
  if (!specifier) return null;
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier: specifier,
    isStyle: isStyleFile(specifier),
    type: "static",
  };
}

/**
 * @description Builds an `ImportEdge` from a CoffeeScript `require()` call AST node.
 * @param filePath - Source file path stamped onto the edge.
 * @param node - CoffeeScript AST node representing a `Call`.
 * @returns An `ImportEdge` for the require call, or `null` if the node is not a `require` call or has no specifier.
 */
function edgeFromRequireCall(filePath: string, node: CoffeeNode): ImportEdge | null {
  const isRequire = node.variable?.base?.value === "require";
  const specifier = stringLiteralValue(node.args?.[0]?.base);
  if (!isRequire || !specifier) return null;
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier: specifier,
    isStyle: isStyleFile(specifier),
    type: "require",
  };
}

/**
 * @description Builds export symbols from a CommonJS `module.exports = { ... }` / `exports.foo = ...`
 *   assignment's right-hand side: named exports for each field of an object literal, the class
 *   name for `module.exports = class Foo`, or the referenced identifier's name for a bare
 *   re-export (`module.exports = Widget`).
 * @param assignNode - The `Assign` AST node whose LHS already matched `module.exports` or `exports.<name>`.
 * @param propertyName - The member name accessed after `exports` (`baz` in `exports.baz = 3`), if any.
 * @returns Export symbols discovered on the assignment's right-hand side.
 */
function exportsFromAssignment(
  assignNode: CoffeeNode,
  propertyName: string | undefined,
): ExportedSymbol[] {
  if (propertyName) return [{ name: propertyName }];

  const rhs = assignNode.value as CoffeeNode | undefined;
  if (rhs?.constructor?.name === "Class") {
    const className = identifierName(rhs.variable);
    return className ? [{ name: className }] : [];
  }
  if (rhs?.base?.constructor?.name === "Obj" && Array.isArray(rhs.base.properties)) {
    // `foo: value` properties are Assign nodes (name via `.variable`); shorthand `{ foo }`
    // properties compile to a bare Value/IdentifierLiteral node instead.
    return rhs.base.properties
      .map((property) => identifierName(property.variable) ?? identifierName(property))
      .filter((name): name is string => !!name)
      .map((name) => ({ name }));
  }
  const bareName = identifierName(rhs);
  return bareName ? [{ name: bareName }] : [];
}

/**
 * @description Builds export symbols from an ES `export ...` declaration clause: `export { a, b }`
 *   specifier lists, `export foo = ...` assignments, and any other clause shape carrying a
 *   `.variable` (e.g. `export class Foo`).
 * @param clause - The `clause` payload of an `ExportNamedDeclaration` node.
 * @returns Export symbols discovered in the clause.
 */
function exportsFromNamedClause(clause: CoffeeNode): ExportedSymbol[] {
  if (Array.isArray(clause.specifiers)) {
    return clause.specifiers
      .map((specifier) => specifier.identifier ?? specifier.original?.value)
      .filter((name): name is string => !!name)
      .map((name) => ({ name }));
  }
  const name = identifierName(clause.variable) ?? identifierName(clause.variable?.base);
  return name ? [{ name }] : [];
}

/**
 * @description Inspects a single CoffeeScript AST node and appends any discovered import edge or
 *   export symbol to the corresponding accumulator. Handles `ImportDeclaration`/`Call` (require)
 *   for imports, and `module.exports`/`exports.<name>` assignments plus ES `export` declarations
 *   for exports.
 * @param filePath - Source file path forwarded to each created edge.
 * @param node - The AST node to inspect.
 * @param imports - Accumulator array that receives any discovered import edge.
 * @param exports - Accumulator array that receives any discovered export symbols.
 */
function visitNode(
  filePath: string,
  node: CoffeeNode,
  imports: ImportEdge[],
  exports: ExportedSymbol[],
): void {
  const className = node.constructor?.name;
  if (className === "ImportDeclaration") {
    const edge = edgeFromImportDeclaration(filePath, node);
    if (edge) imports.push(edge);
  } else if (className === "Call") {
    const edge = edgeFromRequireCall(filePath, node);
    if (edge) imports.push(edge);
  } else if (className === "Assign") {
    const base = identifierName(node.variable?.base);
    const propertyName = node.variable?.properties?.[0]?.name?.value;
    if (base === "module" && propertyName === "exports") {
      exports.push(...exportsFromAssignment(node, undefined));
    } else if (base === "exports" && typeof propertyName === "string") {
      exports.push(...exportsFromAssignment(node, propertyName));
    }
  } else if (className === "ExportNamedDeclaration" && node.clause) {
    exports.push(...exportsFromNamedClause(node.clause));
  } else if (className === "ExportDefaultDeclaration") {
    exports.push({ name: "default" });
  }
}

/**
 * @description Recursively walks the CoffeeScript AST and collects all import edges and export
 *   symbols into the given accumulators. Skips `locationData` keys to prevent infinite cycles on
 *   circular metadata references.
 * @param filePath - Source file path forwarded to each created edge.
 * @param node - The AST node to walk.
 * @param imports - Accumulator array that receives all discovered import edges.
 * @param exports - Accumulator array that receives all discovered export symbols.
 */
function traverse(
  filePath: string,
  node: CoffeeNode,
  imports: ImportEdge[],
  exports: ExportedSymbol[],
): void {
  if (!node || typeof node !== "object") return;
  visitNode(filePath, node, imports, exports);
  for (const key in node) {
    if (key === "locationData") continue;
    const child = node[key];
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const c of child) traverse(filePath, c as CoffeeNode, imports, exports);
    } else {
      traverse(filePath, child as CoffeeNode, imports, exports);
    }
  }
}

/**
 * @description Parses a CoffeeScript source file and extracts its import edges, module exports,
 *   comment-marker tags, and file category. Uses the CoffeeScript compiler's `nodes()` API for
 *   full AST traversal, capturing ES `import`/`export` declarations as well as CommonJS
 *   `require()`/`module.exports` conventions. Falls back to empty imports/exports if the file
 *   fails to parse.
 * @param filePath - Absolute or project-relative path to the `.coffee` file.
 * @param content - Raw source text of the file.
 * @returns Parsed imports, exports, extracted tags, and resolved category.
 */
export function parseCoffeeScript(filePath: string, content: string): ParseResult {
  const tags = extractTags(content);
  const category = resolveCategory(filePath, tags);
  const imports: ImportEdge[] = [];
  const exports: ExportedSymbol[] = [];

  try {
    traverse(filePath, coffee.nodes(content) as unknown as CoffeeNode, imports, exports);
  } catch (_e) {
    // coffeescript compiler throws on invalid syntax; return what we have
  }

  const seenNames = new Set<string>();
  const dedupedExports = exports.filter((symbol) => {
    if (seenNames.has(symbol.name)) return false;
    seenNames.add(symbol.name);
    return true;
  });

  return {
    imports,
    exports: dedupedExports,
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
