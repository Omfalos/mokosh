import coffee from "coffeescript";
import type { ImportEdge } from "../types";
import { isStyleFile } from "./file-type";
import type { ParseResult } from "./types";

interface CoffeeNode {
  constructor: { name: string };
  source?: { value: string };
  variable?: { base?: { value: string } };
  args?: Array<{ base?: { value: string } }>;
  [key: string]: unknown;
}

/** Extracts `@tag <name>` annotations from raw file content. */
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

/** Returns `"test"` if the path or tags indicate a test file, otherwise `"logic"`. */
function resolveCategory(filePath: string, tags: Set<string>): "test" | "logic" {
  const lower = filePath.toLowerCase();
  if (lower.includes(".test.") || lower.includes(".spec.") || tags.has("test")) {
    return "test";
  }
  return "logic";
}

/** Builds an `ImportEdge` from a static `import` AST node. */
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

/** Builds an `ImportEdge` from a `require()` call AST node. */
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

/** Visits a single AST node and pushes any discovered import edge into `out`. */
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

/** Recursively walks the CoffeeScript AST, skipping `locationData` to avoid cycles. */
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
 * Parses a CoffeeScript file and extracts its imports, tags, and category.
 *
 * Uses the CoffeeScript compiler's `nodes()` API for full AST traversal,
 * capturing both ES `import` declarations and CommonJS `require()` calls.
 * Falls back to an empty import list if the file fails to parse.
 *
 * @param filePath - Absolute or project-relative path to the `.coffee` file.
 * @param content  - Raw source text of the file.
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
