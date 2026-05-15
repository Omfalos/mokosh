// @ts-expect-error
import ls from "livescript";
import type { ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";
import { stripQuotes } from "../utils";

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
 * @description Scans raw source text for `@tag` comment markers and collects the tag
 *   names they carry. Runs before AST parsing so tags are available for classification.
 * @param content - Raw source text of the LiveScript file.
 * @returns A set of tag name strings found in `@tag` annotations.
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
 *   path conventions (.test., .spec.) and the presence of an explicit `@tag test` annotation.
 * @param filePath - Absolute or relative path to the file being classified.
 * @param tags - Tag names extracted from the file's comments.
 * @returns "test" if the file is identified as a test file, "logic" otherwise.
 */
function classifyFile(filePath: string, tags: Set<string>): "test" | "logic" {
  const lower = filePath.toLowerCase();
  return lower.includes(".test.") || lower.includes(".spec.") || tags.has("test")
    ? "test"
    : "logic";
}

const POSITIONAL_KEYS = new Set([
  "first_line",
  "first_column",
  "last_line",
  "last_column",
  "line",
  "column",
]);

/**
 * @description Inspects a single AST node and returns an ImportEdge if the node represents
 *   an `import` statement or a `require()` call, or null if it is neither.
 * @param node - The AST node to inspect.
 * @param filePath - Source path to stamp onto any emitted edge.
 * @returns An ImportEdge for the detected dependency, or null if the node is not an import.
 */
function extractEdge(node: LiveScriptNode, filePath: string): ImportEdge | null {
  const type = node.constructor?.name || node.type;

  if (type === "Import") {
    const raw = node.right?.value;
    if (typeof raw === "string") {
      const specifier = stripQuotes(raw);
      return {
        fromPath: filePath,
        toPath: "",
        rawSpecifier: specifier,
        isStyle: isStyleFile(specifier),
        type: "static",
      };
    }
  }

  if (type === "Chain" && node.head?.value === "require") {
    const call = node.tails?.[0];
    if (call?.constructor?.name === "Call" || call?.type === "Call") {
      const raw = call.args?.[0]?.value;
      if (typeof raw === "string") {
        const specifier = stripQuotes(raw);
        return {
          fromPath: filePath,
          toPath: "",
          rawSpecifier: specifier,
          isStyle: isStyleFile(specifier),
          type: "require",
        };
      }
    }
  }

  return null;
}

/**
 * @description Recursively walks a LiveScript AST and collects all import edges found
 *   within the tree. Skips positional metadata keys to avoid infinite recursion.
 * @param node - The root AST node to walk.
 * @param filePath - Source path forwarded to each discovered edge.
 * @returns All ImportEdge values found in this node and its descendants.
 */
function collectEdges(node: LiveScriptNode, filePath: string): ImportEdge[] {
  if (!node || typeof node !== "object") return [];

  const edges: ImportEdge[] = [];
  const edge = extractEdge(node, filePath);
  if (edge) edges.push(edge);

  for (const key in node) {
    if (POSITIONAL_KEYS.has(key)) continue;
    const child = node[key];
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const c of child) edges.push(...collectEdges(c as LiveScriptNode, filePath));
    } else {
      edges.push(...collectEdges(child as LiveScriptNode, filePath));
    }
  }

  return edges;
}

/**
 * @description Parses a LiveScript source file to extract its dependency edges, comment-marker
 *   tags, and file category. Handles both ES-style `import` statements and CommonJS `require()`
 *   calls. Falls back gracefully if the LiveScript AST cannot be produced.
 * @param filePath - Path used as the source identifier on all emitted import edges.
 * @param content - Raw LiveScript source text to parse.
 * @returns A ParseResult with collected imports, an empty exports list, extracted tags, and the file category.
 */
export function parseLiveScript(filePath: string, content: string): ParseResult {
  const tags = extractTags(content);
  const category = classifyFile(filePath, tags);
  let imports: ImportEdge[] = [];

  try {
    imports = collectEdges(ls.ast(content) as LiveScriptNode, filePath);
  } catch (_e) {
    // ignore parse errors
  }

  return {
    imports,
    exports: [],
    tags: Array.from(tags).map((name) => ({ name, kind: "comment-marker" as const })),
    category,
  };
}
