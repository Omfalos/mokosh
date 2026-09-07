/** Single source of truth for which languages' parsers track which precision-relevant data. */
import type { FileType } from "../types/parse";
import type { Graph } from "./model";

/** JVM languages — share the `JvmLangResolver` package model and Gradle/sbt dependency metadata. */
export const JVM_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "java",
  "kotlin",
  "scala",
  "groovy",
]);

/** File types whose parser ever populates `FileNode.exports`. */
export const EXPORT_TRACKING_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "kotlin",
  "scala",
  "groovy",
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
  "java",
]);

/** File types whose parser populates the per-function complexity breakdown (`FileNode.functions`). */
export const FUNCTION_COMPLEXITY_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "go",
  "python",
]);

/** File types the type graph (`buildTypeGraph`) can extract interfaces/classes/enums/aliases from. */
export const TYPE_GRAPH_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
]);

/** A graph-analysis capability that only some languages' parsers feed. */
export type LanguageFeature = "callEdges" | "functionComplexity" | "typeGraph";

const FEATURE_TYPES: Record<LanguageFeature, ReadonlySet<FileType>> = {
  callEdges: CALL_EDGE_TYPES,
  functionComplexity: FUNCTION_COMPLEXITY_TYPES,
  typeGraph: TYPE_GRAPH_TYPES,
};

const FEATURE_LABEL: Record<LanguageFeature, string> = {
  callEdges: "call edges",
  functionComplexity: "per-function complexity",
  typeGraph: "type extraction",
};

/**
 * @description Returns an explanatory note when none of the graphs contain a language whose
 *   parser feeds `feature` — so an empty tool result (`count: 0`) reads as "language not
 *   supported" rather than "nothing found". Returns `undefined` when at least one supported-
 *   language file is present (the empty result is then genuine).
 * @param graphs - One graph, or the per-package graphs of a workspace.
 * @param feature - The capability the calling tool depends on.
 * @returns A one-sentence note, or `undefined`.
 */
export function languageSupportNote(
  graphs: Graph | Graph[],
  feature: LanguageFeature,
): string | undefined {
  const list = Array.isArray(graphs) ? graphs : [graphs];
  const supported = FEATURE_TYPES[feature];
  const present = new Set<FileType>();
  for (const graph of list) {
    for (const node of graph.nodes.values()) {
      if (supported.has(node.type)) return undefined;
      if (node.type !== "markdown" && node.type !== "unknown") present.add(node.type);
    }
  }
  const langs = [...present].sort();
  const subject = langs.length === 0 ? "this project" : langs.join(", ");
  const verb = langs.length === 1 ? "is" : "are";
  return `${FEATURE_LABEL[feature]} is only tracked for ${[...supported].sort().join(", ")} — ${subject} ${verb} unsupported, so this result is empty by design.`;
}

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
