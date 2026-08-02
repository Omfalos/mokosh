/** Single source of truth for which languages' parsers track which precision-relevant data. */
import type { FileType } from "../types/parse";
import type { Graph } from "./model";

/** File types whose parser ever populates `FileNode.exports`. */
export const EXPORT_TRACKING_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "python",
  "go",
  "scss",
  "less",
  "lua",
  "coffeescript",
]);

/** File types whose parser records which named symbols each import edge pulls in (`ImportEdge.symbols`). */
export const IMPORT_SYMBOL_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "python",
]);

/** File types whose parser records function-level call edges (`FileNode.callEdges`). */
export const CALL_EDGE_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "go",
  "python",
]);

export interface LanguageCoverage {
  type: FileType;
  fileCount: number;
  exportsTracked: boolean;
  importSymbolsTracked: boolean;
  callEdgesTracked: boolean;
}

/**
 * @description Reports which precision-relevant data mokosh actually tracks for each language
 *   present in `graph` — so a caller can tell upfront whether tools like `find_symbol` or
 *   `get_call_graph` will give call-level precision, degrade to import-level, or find nothing
 *   at all for a given file, before running a query and being surprised by the result.
 * @param graph - The graph to summarize.
 * @returns One entry per `FileType` actually present in `graph`, sorted by file count
 *   descending. Languages with zero files in this graph are omitted.
 */
export function getLanguageCoverage(graph: Graph): LanguageCoverage[] {
  const counts = new Map<FileType, number>();
  for (const node of graph.nodes.values()) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, fileCount]) => ({
      type,
      fileCount,
      exportsTracked: EXPORT_TRACKING_TYPES.has(type),
      importSymbolsTracked: IMPORT_SYMBOL_TYPES.has(type),
      callEdgesTracked: CALL_EDGE_TYPES.has(type),
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
}
