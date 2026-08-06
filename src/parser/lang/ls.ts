/** Parses LiveScript files to extract import edges, module exports, and tag annotations. */
// @ts-expect-error
import ls from "livescript";
import type { ExportedSymbol, ImportEdge } from "../../types/node";
import { isStyleFile } from "../file-type";
import type { ParseResult } from "../types";
import { classifyTestOrLogic, extractTagAnnotations, stripQuotes } from "../utils";

interface LiveScriptNode {
  constructor: { name: string };
  type?: string;
  value?: string;
  right?: LiveScriptNode;
  left?: LiveScriptNode;
  head?: LiveScriptNode & { value?: string; verb?: string };
  base?: LiveScriptNode;
  verb?: string;
  key?: LiveScriptNode & { name?: string };
  name?: string;
  title?: LiveScriptNode;
  items?: LiveScriptNode[];
  val?: LiveScriptNode;
  tails?: Array<{
    constructor: { name: string };
    type?: string;
    args?: Array<{ value: string }>;
    key?: LiveScriptNode & { name?: string };
  }>;
  [key: string]: unknown;
}

/**
 * @description Resolves the plain identifier name held by a LiveScript AST node, handling bare
 *   `Var` nodes (`.value`) and `Value`-wrapped identifiers (`.base.value`).
 * @param node - The AST node to resolve, or `undefined`.
 * @returns The identifier's string name, or `undefined` if `node` isn't a simple identifier.
 */
function identifierName(node: LiveScriptNode | undefined): string | undefined {
  if (!node) return undefined;
  if (typeof node.value === "string") return node.value;
  if (typeof node.base?.value === "string") return node.base.value;
  return undefined;
}

/**
 * @description Builds export symbols from the right-hand side of a `module.exports = ...` /
 *   `export <name> = ...` assignment: named exports for each field of an object literal, the
 *   class name for `= class Foo`, or the referenced identifier's name for a bare re-export.
 * @param rhs - The assignment's right-hand-side AST node.
 * @returns Export symbols discovered on the right-hand side.
 */
function exportsFromValue(rhs: LiveScriptNode | undefined): ExportedSymbol[] {
  if (!rhs) return [];
  if (rhs.constructor?.name === "Class") {
    const className = identifierName(rhs.title);
    return className ? [{ name: className }] : [];
  }
  if (rhs.constructor?.name === "Obj" && Array.isArray(rhs.items)) {
    return rhs.items
      .map((prop) => identifierName(prop.key) ?? identifierName(prop.val))
      .filter((name): name is string => !!name)
      .map((name) => ({ name }));
  }
  const bareName = identifierName(rhs);
  return bareName ? [{ name: bareName }] : [];
}

/**
 * @description Inspects a single AST node and returns export symbols if the node represents a
 *   `module.exports = ...` / `exports.<name> = ...` CommonJS assignment, or an `export <decl>` /
 *   `export {a, b}` LiveScript declaration (both compile through the `out` verb), or an empty
 *   array otherwise.
 * @param node - The AST node to inspect.
 * @returns Export symbols discovered on this node, if any.
 */
function extractExports(node: LiveScriptNode): ExportedSymbol[] {
  const type = node.constructor?.name || node.type;

  if (type === "Assign" && node.left?.constructor?.name === "Chain") {
    const chain = node.left;
    const base = identifierName(chain.head);
    const tailIndex = chain.tails?.[0];
    const propertyName = tailIndex?.key?.name;

    if (base === "module" && propertyName === "exports") {
      return exportsFromValue(node.right);
    }
    if (base === "exports" && typeof propertyName === "string") {
      return [{ name: propertyName }];
    }
    if (chain.head?.verb === "out" && typeof propertyName === "string") {
      return [{ name: propertyName }];
    }
  }

  if (type === "Import" && node.left?.verb === "out") {
    const rhs = node.right;
    if (rhs?.constructor?.name === "Obj" && Array.isArray(rhs.items)) {
      return rhs.items
        .map((prop) => identifierName(prop.val) ?? identifierName(prop.key))
        .filter((name): name is string => !!name)
        .map((name) => ({ name }));
    }
  }

  return [];
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
 * @description Recursively walks a LiveScript AST and collects all import edges and export
 *   symbols found within the tree. Skips positional metadata keys to avoid infinite recursion.
 * @param node - The root AST node to walk.
 * @param filePath - Source path forwarded to each discovered edge.
 * @param exports - Accumulator array that receives all discovered export symbols.
 * @returns All ImportEdge values found in this node and its descendants.
 */
function collectEdges(
  node: LiveScriptNode,
  filePath: string,
  exports: ExportedSymbol[],
): ImportEdge[] {
  if (!node || typeof node !== "object") return [];

  const edges: ImportEdge[] = [];
  const edge = extractEdge(node, filePath);
  if (edge) edges.push(edge);
  exports.push(...extractExports(node));

  for (const key in node) {
    if (POSITIONAL_KEYS.has(key)) continue;
    const child = node[key];
    if (!child || typeof child !== "object") continue;
    if (Array.isArray(child)) {
      for (const c of child) edges.push(...collectEdges(c as LiveScriptNode, filePath, exports));
    } else {
      edges.push(...collectEdges(child as LiveScriptNode, filePath, exports));
    }
  }

  return edges;
}

/**
 * @description Parses a LiveScript source file to extract its dependency edges, module exports,
 *   comment-marker tags, and file category. Handles both ES-style `import` statements and
 *   CommonJS `require()` calls, plus the `module.exports`/`exports.<name>` and `export ...`
 *   conventions. Falls back gracefully if the LiveScript AST cannot be produced.
 * @param filePath - Path used as the source identifier on all emitted import edges.
 * @param content - Raw LiveScript source text to parse.
 * @returns A ParseResult with collected imports, exports, extracted tags, and the file category.
 */
export function parseLiveScript(filePath: string, content: string): ParseResult {
  const tags = extractTagAnnotations(content);
  const category = classifyTestOrLogic(filePath, tags);
  let imports: ImportEdge[] = [];
  const exports: ExportedSymbol[] = [];

  try {
    imports = collectEdges(ls.ast(content) as LiveScriptNode, filePath, exports);
  } catch (_e) {
    // ignore parse errors
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
