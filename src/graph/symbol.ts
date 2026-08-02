/** Symbol-name lookup across the whole graph — generalizes queryCallGraph beyond TS/JS functions. */
import type { NodeCategory } from "../types/parse";
import { CALL_EDGE_TYPES } from "./language-support";
import type { Graph } from "./model";
import { getDependents } from "./queries";

export type SymbolPrecision = "call" | "file-level";

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

/**
 * @description Finds every file that exports a symbol by name, with the best available
 *   usage info per match. Precision depends on what the defining file's language parser
 *   tracks: TS/JS, Go, and Python get function-level callers via call edges (`"call"`);
 *   everything else falls back to whole-file dependents (`"file-level"` — import-level, not
 *   symbol-level, since the file might not even use this specific export). Coverage still
 *   differs across the `"call"` languages: TS/JS tracks any directly imported symbol, Go only
 *   package-qualified calls, Python only bare calls to `from <module> import <name>` symbols.
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
