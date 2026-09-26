/** Single source of truth for which languages' parsers track which precision-relevant data. */
import type { FidelityLevel, LanguageFidelity } from "../languages";
import { getAdapter, LANGUAGE_ADAPTERS, typesInFamily, typesWithCapability } from "../languages";
import type { FileType } from "../types/parse";
import type { Graph } from "./model";

/** JVM languages — share the `JvmLangResolver` package model and Gradle/sbt dependency metadata. */
export const JVM_TYPES: ReadonlySet<FileType> = typesInFamily("jvm");

/** File types whose parser ever populates `FileNode.exports`. */
export const EXPORT_TRACKING_TYPES: ReadonlySet<FileType> = typesWithCapability("exportSymbols");

/** File types whose parser records which named symbols each import edge pulls in (`ImportEdge.symbols`). */
export const IMPORT_SYMBOL_TYPES: ReadonlySet<FileType> = typesWithCapability("importSymbols");

/** File types whose parser records function-level call edges (`FileNode.callEdges`). */
export const CALL_EDGE_TYPES: ReadonlySet<FileType> = typesWithCapability("callEdges");

/** File types whose parser populates the per-function complexity breakdown (`FileNode.functions`)
 *  plus file-level `complexity` / `cognitiveComplexity`. */
export const FUNCTION_COMPLEXITY_TYPES: ReadonlySet<FileType> =
  typesWithCapability("functionComplexity");

/** File types with a dedicated test-tag strategy (`src/tags/strategies/`) — a framework-aware
 *  applier, not the generic path-glob fallback. */
export const TEST_TAG_STRATEGY_TYPES: ReadonlySet<FileType> = typesWithCapability("testTags");

/** File types the type graph (`buildTypeGraph`) can extract interfaces/classes/enums/aliases from. */
export const TYPE_GRAPH_TYPES: ReadonlySet<FileType> = typesWithCapability("typeGraph");

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

export type { FidelityLevel, LanguageFidelity };

/**
 * Authoritative per-language fidelity matrix, derived from the adapters in `src/languages/` — see
 * `docs/language-support.md` for the same table with per-language known-limitations prose and ADR
 * links. Every {@link FileType} has an entry.
 */
export const LANGUAGE_FIDELITY: Record<FileType, LanguageFidelity> = Object.fromEntries(
  LANGUAGE_ADAPTERS.map((adapter) => [adapter.type, adapter.fidelity]),
) as Record<FileType, LanguageFidelity>;

/** Human-readable label for each fidelity axis, used in caveat sentences. */
const AXIS_LABEL: Record<keyof LanguageFidelity, string> = {
  importResolution: "import resolution",
  exportSymbols: "export symbols",
  importSymbols: "per-import symbol tracking",
  callEdges: "call edges",
  complexity: "complexity",
  category: "category classification",
  duplication: "duplicate detection",
  testTags: "test-tag strategy",
};

/** Axes worth summarising in `analyze`'s aggregate `caveats` — the precision-relevant ones a
 *  caller would otherwise trust blindly. `category`/`duplication`/`testTags` are omitted here;
 *  the tools that depend on them surface their own note. */
const SUMMARY_AXES: readonly (keyof LanguageFidelity)[] = [
  "importResolution",
  "exportSymbols",
  "importSymbols",
  "callEdges",
  "complexity",
];

/**
 * @description Returns one advisory sentence per language present in `graphs` whose `axis`
 *   fidelity is `"partial"` or `"none"` — so a tool whose result is real but *lossy* for the
 *   languages in play (e.g. `get_call_graph` on a Java repo: constructors only) can say so
 *   instead of returning a confident-looking result. Complements {@link languageSupportNote},
 *   which only fires when the result is fully empty *and* no supported-language file is present.
 * @param graphs - One graph, or the per-package graphs of a workspace.
 * @param axis - The fidelity axis the calling tool depends on.
 * @returns Sorted, de-duplicated caveat sentences; empty when every present language is `"full"`
 *   for `axis` (or the only files are markdown/unknown).
 */
export function languageCaveats(graphs: Graph | Graph[], axis: keyof LanguageFidelity): string[] {
  const list = Array.isArray(graphs) ? graphs : [graphs];
  const present = new Set<FileType>();
  for (const graph of list) {
    for (const node of graph.nodes.values()) {
      if (node.type !== "markdown" && node.type !== "unknown") present.add(node.type);
    }
  }
  const out: string[] = [];
  for (const type of present) {
    const level = LANGUAGE_FIDELITY[type][axis];
    if (level === "full") continue;
    const reason = getAdapter(type).caveats?.[axis];
    // Emit only when there's a concrete reason, or the axis is entirely absent for this
    // language. A bare `"partial"` with no explanation (the norm for `category` / `duplication`)
    // isn't worth a line — it would fire on nearly every repo.
    if (!reason && level !== "none") continue;
    out.push(
      `${type}: ${AXIS_LABEL[axis]} is ${
        reason ?? "not available for this language — see docs/language-support.md"
      }`,
    );
  }
  return out.sort();
}

/**
 * @description Aggregates {@link languageCaveats} across the precision-relevant axes
 *   ({@link SUMMARY_AXES}) for an `analyze` response, so a caller sees upfront — from the first
 *   call — where results for this repo's languages will be lossy.
 * @param graphs - One graph, or the per-package graphs of a workspace.
 * @returns Sorted, de-duplicated caveat sentences; empty for an all-`full` (e.g. all-TS) repo.
 */
export function languageCaveatsSummary(graphs: Graph | Graph[]): string[] {
  const seen = new Set<string>();
  for (const axis of SUMMARY_AXES) {
    for (const c of languageCaveats(graphs, axis)) seen.add(c);
  }
  return [...seen].sort();
}

export interface LanguageCoverage {
  type: FileType;
  fileCount: number;
  exportsTracked: boolean;
  importSymbolsTracked: boolean;
  callEdgesTracked: boolean;
  /** The full per-axis fidelity for this language — see {@link LANGUAGE_FIDELITY}. */
  fidelity: LanguageFidelity;
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
      fidelity: LANGUAGE_FIDELITY[type],
    }))
    .sort((a, b) => b.fileCount - a.fileCount);
}
