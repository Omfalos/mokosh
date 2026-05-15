import coffee from "coffeescript";
import type { ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";

interface CoffeeNode {
  constructor: { name: string };
  source?: { value: string };
  variable?: { base?: { value: string } };
  args?: Array<{ base?: { value: string } }>;
  [key: string]: unknown;
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
  const specifier = node.source?.value;
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
  const specifier = node.args?.[0]?.base?.value;
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
 * @description Inspects a single CoffeeScript AST node and appends any discovered import edge
 *   to the accumulator array. Handles both `ImportDeclaration` and `Call` (require) node types.
 * @param filePath - Source file path forwarded to each created edge.
 * @param node - The AST node to inspect.
 * @param out - Accumulator array that receives any discovered edge.
 */
function visitNode(filePath: string, node: CoffeeNode, out: ImportEdge[]): void {
  const className = node.constructor?.name;
  if (className === "ImportDeclaration") {
    const edge = edgeFromImportDeclaration(filePath, node);
    if (edge) out.push(edge);
  } else if (className === "Call") {
    const edge = edgeFromRequireCall(filePath, node);
    if (edge) out.push(edge);
  }
}

/**
 * @description Recursively walks the CoffeeScript AST and collects all import edges into `out`.
 *   Skips `locationData` keys to prevent infinite cycles on circular metadata references.
 * @param filePath - Source file path forwarded to each created edge.
 * @param node - The AST node to walk.
 * @param out - Accumulator array that receives all discovered edges.
 */
function traverse(filePath: string, node: CoffeeNode, out: ImportEdge[]): void {
  if (!node || typeof node !== "object") return;
  visitNode(filePath, node, out);
  for (const key in node) {
    if (key === "locationData") continue;
    const child = node[key];
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const c of child) traverse(filePath, c as CoffeeNode, out);
    } else {
      traverse(filePath, child as CoffeeNode, out);
    }
  }
}

/**
 * @description Parses a CoffeeScript source file and extracts its import edges, comment-marker
 *   tags, and file category. Uses the CoffeeScript compiler's `nodes()` API for full AST
 *   traversal, capturing both ES `import` declarations and CommonJS `require()` calls.
 *   Falls back to an empty import list if the file fails to parse.
 * @param filePath - Absolute or project-relative path to the `.coffee` file.
 * @param content - Raw source text of the file.
 * @returns Parsed imports, empty exports list, extracted tags, and resolved category.
 */
export function parseCoffeeScript(filePath: string, content: string): ParseResult {
  const tags = extractTags(content);
  const category = resolveCategory(filePath, tags);
  const imports: ImportEdge[] = [];

  try {
    traverse(filePath, coffee.nodes(content) as unknown as CoffeeNode, imports);
  } catch (_e) {
    // coffeescript compiler throws on invalid syntax; return what we have
  }

  return {
    imports,
    exports: [],
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
