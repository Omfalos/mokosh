/** Symbol-name lookup across the whole graph — generalizes queryCallGraph beyond TS/JS functions. */
import type { FileType, NodeCategory } from "../types/parse";
import type { Graph } from "./model";
import { getDependents } from "./queries";

export type SymbolPrecision = "call" | "import-symbol" | "file-level";

export interface SymbolCaller {
  file: string;
  callerFunction: string;
}

export interface SymbolImporter {
  file: string;
  symbols?: string[];
}

export interface SymbolMatch {
  path: string;
  category: NodeCategory;
  precision: SymbolPrecision;
  callers?: SymbolCaller[];
  importers?: SymbolImporter[];
}

/** File types whose parser records function-level call edges (`FileNode.callEdges`). */
const CALL_EDGE_TYPES = new Set<FileType>(["typescript", "javascript"]);

/** File types whose parser records which named symbols each import edge pulls in (`ImportEdge.symbols`). */
const IMPORT_SYMBOL_TYPES = new Set<FileType>(["typescript", "javascript", "python"]);

/**
 * @description Finds every file that exports a symbol by name, with the best available
 *   usage info per match. Precision depends on what the defining file's language parser
 *   tracks: TS/JS gets function-level callers via call edges, Python gets named-import
 *   tracking, everything else falls back to whole-file dependents (import-level, not
 *   symbol-level — the file might not even use this specific export).
 * @param graph - The graph to search.
 * @param name - Exact export name to look up.
 * @returns One entry per file that exports `name`; empty if no file does (including
 *   languages — CoffeeScript, LiveScript, Lua, Gherkin, Markdown, CSS/SCSS/Stylus — whose
 *   parsers never populate `exports` at all).
 */
export function findSymbol(graph: Graph, name: string): SymbolMatch[] {
  const matches: SymbolMatch[] = [];

  for (const node of graph.nodes.values()) {
    if (!node.exports.some((exportedSym) => exportedSym.name === name)) continue;

    if (CALL_EDGE_TYPES.has(node.type)) {
      const callers: SymbolCaller[] = [];
      for (const other of graph.nodes.values()) {
        for (const edge of other.callEdges ?? []) {
          if (edge.to === name) callers.push({ file: other.path, callerFunction: edge.from });
        }
      }
      matches.push({ path: node.path, category: node.category, precision: "call", callers });
    } else if (IMPORT_SYMBOL_TYPES.has(node.type)) {
      const importers: SymbolImporter[] = [];
      for (const other of graph.nodes.values()) {
        for (const edge of other.imports) {
          if (edge.toPath === node.path && edge.symbols?.includes(name)) {
            importers.push({ file: other.path, symbols: edge.symbols });
          }
        }
      }
      matches.push({
        path: node.path,
        category: node.category,
        precision: "import-symbol",
        importers,
      });
    } else {
      const importers = getDependents(graph, node.path).map((dependent) => ({
        file: dependent.path,
        ...(dependent.symbols ? { symbols: dependent.symbols } : {}),
      }));
      matches.push({
        path: node.path,
        category: node.category,
        precision: "file-level",
        importers,
      });
    }
  }

  return matches;
}
