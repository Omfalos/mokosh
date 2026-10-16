/** Builds and queries a TypeGraph of interface, class, enum, and type-alias exports and the files that reference them. */
import type { TypeKind } from "../languages";
import { getAdapter } from "../languages";
import type { ExportedSymbol, FileNode } from "../types/node";
import type { Graph } from "./model";

export type { TypeKind };

/**
 * A single type-like export extracted from a TypeScript source file.
 * Only interfaces, classes, enums, and type aliases are included —
 * plain functions and values are excluded.
 */
export interface TypeNode {
  /** Exported symbol name (e.g. `"FileNode"`). */
  name: string;
  /** Project-relative path of the file that exports this type. */
  file: string;
  /** Structural kind inferred from the export signature. */
  kind: TypeKind;
  /** JSDoc description attached to the export, if present. */
  doc?: string;
}

/**
 * A directed edge representing that one file imports a specific type from another file.
 */
export interface TypeEdge {
  /** Project-relative path of the importing file. */
  fromFile: string;
  /** Name of the imported type. */
  toType: string;
  /** Project-relative path of the file that defines the type. */
  toFile: string;
}

/**
 * Type-level view of the import graph.
 * Answers "what types depend on X?" and "what does type X depend on?"
 * at a fraction of the cost of sending the full graph.
 */
export interface TypeGraph {
  /**
   * All type-like exports in the graph.
   * Key format: `"<file>::<typeName>"` (e.g. `"src/types/node.ts::FileNode"`).
   */
  types: Map<string, TypeNode>;
  /** All import edges where the imported symbol is a known type. */
  edges: TypeEdge[];
}

/**
 * Result of a focused query for one named type.
 * A token-efficient answer to "what types depend on X?" and "what does X use?"
 */
export interface TypeQueryResult {
  /** The type that was queried. */
  type: TypeNode | null;
  /** Project-relative paths of files that import this type. */
  usedByFiles: string[];
  /** Types that the defining file imports from other files. */
  uses: TypeNode[];
}

/**
 * Default (TS/JS) type-kind rule, from the prefix patterns produced by `extractSignature` in the
 * TS parser. Structural types (interface / class / enum) are type-like; plain functions and
 * values are not.
 *
 * @param signature - The signature string from `ExportedSymbol.signature`, if present.
 * @returns The `TypeKind`, or `undefined` when the export is not type-like.
 */
function jsTypeKind(signature: string | undefined): TypeKind | undefined {
  if (!signature) return undefined;
  if (signature.startsWith("interface ")) return "interface";
  if (signature.startsWith("class ")) return "class";
  if (signature.startsWith("enum ")) return "enum";
  return undefined;
}

/**
 * Resolves the type kind of an export, or `undefined` when it should not appear in the type graph.
 * In `type-only` files every export is a type (kind `"type"` unless the signature says otherwise).
 *
 * @param sym - The exported symbol to test.
 * @param node - The file defining it.
 * @returns The `TypeKind`, or `undefined` to exclude the symbol.
 */
function typeKindOf(sym: ExportedSymbol, node: FileNode): TypeKind | undefined {
  const kind = (getAdapter(node.type).hooks?.typeKind ?? jsTypeKind)(sym.signature);
  if (kind) return kind;
  return node.category === "type-only" ? "type" : undefined;
}

/**
 * Builds a type-level view of the import graph by extracting all type-like exports
 * and the import edges that connect them.
 *
 * Only languages whose adapter declares the `typeGraph` capability (TypeScript, JavaScript,
 * Kotlin, Java) are considered — other file types carry no type information usable here.
 *
 * @param graph - The import graph to derive the type graph from.
 * @returns A `TypeGraph` with all type nodes and their dependency edges.
 */
export function buildTypeGraph(graph: Graph): TypeGraph {
  const types = new Map<string, TypeNode>();

  // Pass 1: collect type nodes from all TS/JS files.
  for (const node of graph.nodes.values()) {
    if (!getAdapter(node.type).capabilities.typeGraph) continue;
    for (const exp of node.exports) {
      const kind = typeKindOf(exp, node);
      if (!kind) continue;
      const key = `${node.path}::${exp.name}`;
      types.set(key, {
        name: exp.name,
        file: node.path,
        kind,
        ...(exp.doc ? { doc: exp.doc } : {}),
      });
    }
  }

  // Pass 2: build edges from import edges whose symbols resolve to known types.
  const edges: TypeEdge[] = [];
  for (const node of graph.nodes.values()) {
    if (!getAdapter(node.type).capabilities.typeGraph) continue;
    for (const imp of node.imports) {
      if (!imp.toPath || imp.isExternal || !imp.symbols?.length) continue;
      for (const sym of imp.symbols) {
        if (types.has(`${imp.toPath}::${sym}`)) {
          edges.push({ fromFile: node.path, toType: sym, toFile: imp.toPath });
        }
      }
    }
  }

  return { types, edges };
}

/**
 * Queries the type graph for a specific named type, returning its direct dependents
 * (files that import it) and its direct dependencies (types it imports).
 *
 * When `typeName` is not found in the graph, `type` is `null` and both lists are empty.
 *
 * @param typeGraph - A previously built `TypeGraph`.
 * @param typeName - Exact exported name of the type to look up (e.g. `"FileNode"`).
 * @returns `TypeQueryResult` with the type node and its one-hop neighbours.
 */
export function queryTypeGraph(typeGraph: TypeGraph, typeName: string): TypeQueryResult {
  // Find the canonical TypeNode for the given name (use the first match if there are multiple files).
  let target: TypeNode | null = null;
  for (const typeNode of typeGraph.types.values()) {
    if (typeNode.name === typeName) {
      target = typeNode;
      break;
    }
  }

  if (!target) return { type: null, usedByFiles: [], uses: [] };

  const usedByFiles = new Set<string>();
  const usesMap = new Map<string, TypeNode>();

  for (const edge of typeGraph.edges) {
    // Files that import this type.
    if (edge.toType === typeName && edge.toFile === target.file) {
      usedByFiles.add(edge.fromFile);
    }
    // Types that the defining file itself imports.
    if (edge.fromFile === target.file) {
      const dep = typeGraph.types.get(`${edge.toFile}::${edge.toType}`);
      if (dep) usesMap.set(`${dep.file}::${dep.name}`, dep);
    }
  }

  return {
    type: target,
    usedByFiles: Array.from(usedByFiles),
    uses: Array.from(usesMap.values()),
  };
}

/** Default cap on types listed by the MCP `get_type_graph` inventory. */
export const DEFAULT_TYPE_INVENTORY_LIMIT = 100;

/** Longest `doc` kept per type in the inventory; the first line only, ellipsised past this. */
export const TYPE_DOC_MAX_CHARS = 120;

/** Filters and cap for {@link summarizeTypeInventory}. */
export interface TypeInventoryOptions {
  /** Max types listed (default 100); non-finite or < 1 falls back to the default. */
  limit?: number | undefined;
  /** Keep only this structural kind. */
  kind?: TypeKind | undefined;
  /** Keep only types whose defining file path contains this substring. */
  path?: string | undefined;
}

/** Token-bounded type inventory: capped list, first-line docs, and the true totals. */
export interface TypeInventorySummary {
  /** Types returned, at most `limit`. */
  count: number;
  /** Types matching `kind`/`path` before the cap. */
  matched: number;
  /** Histogram of `kind` over all matched types (not just the returned ones). */
  byKind: Partial<Record<TypeKind, number>>;
  /** The returned types, with `doc` cut to its first line. */
  types: TypeNode[];
  /** Present (true) only when `types` was cut short by `limit`. */
  truncated?: true;
  /** Present only when truncated: how to narrow or widen. */
  hint?: string;
}

/**
 * @description Reduces a type graph to a bounded inventory: applies the optional `kind`/`path` filters,
 *   caps the list, and shortens each `doc` to its first line (full multi-line JSDoc roughly tripled the payload).
 * @param {TypeGraph} typeGraph - Full type graph from {@link buildTypeGraph}.
 * @param {TypeInventoryOptions} [options] - `limit`, `kind` and `path` filters.
 * @returns {TypeInventorySummary} `{ count, matched, byKind, types, truncated?, hint? }`.
 */
export function summarizeTypeInventory(
  typeGraph: TypeGraph,
  options?: TypeInventoryOptions,
): TypeInventorySummary {
  const requested = options?.limit;
  const limit =
    requested !== undefined && Number.isFinite(requested) && requested >= 1
      ? Math.trunc(requested)
      : DEFAULT_TYPE_INVENTORY_LIMIT;
  const matchedTypes = Array.from(typeGraph.types.values()).filter(
    (node) =>
      (!options?.kind || node.kind === options.kind) &&
      (!options?.path || node.file.includes(options.path)),
  );
  const byKind: Partial<Record<TypeKind, number>> = {};
  for (const node of matchedTypes) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;
  const types = matchedTypes.slice(0, limit).map(shortenDoc);
  const truncated = types.length < matchedTypes.length;
  return {
    count: types.length,
    matched: matchedTypes.length,
    byKind,
    types,
    ...(truncated && {
      truncated: true as const,
      hint: `Showing ${types.length} of ${matchedTypes.length} types. Narrow with kind or path, raise limit, or pass type:"<name>" for one type's usedByFiles/uses.`,
    }),
  };
}

/**
 * @param {TypeNode} node - Type node whose `doc` may span several lines.
 * @returns {TypeNode} The same node with `doc` cut to its first line (≤ 120 chars); `doc` is dropped if blank.
 */
function shortenDoc(node: TypeNode): TypeNode {
  if (!node.doc) return node;
  const { doc, ...rest } = node;
  const firstLine = (doc.split("\n", 1)[0] ?? "").trim();
  if (!firstLine) return rest;
  return {
    ...rest,
    doc:
      firstLine.length > TYPE_DOC_MAX_CHARS
        ? `${firstLine.slice(0, TYPE_DOC_MAX_CHARS - 1)}…`
        : firstLine,
  };
}
