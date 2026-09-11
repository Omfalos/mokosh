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
  "java",
  "kotlin",
  "scala",
  "groovy",
]);

/** File types whose parser records function-level call edges (`FileNode.callEdges`). */
export const CALL_EDGE_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "go",
  "python",
  "java",
]);

/** File types whose parser populates the per-function complexity breakdown (`FileNode.functions`)
 *  plus file-level `complexity` / `cognitiveComplexity`. */
export const FUNCTION_COMPLEXITY_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "go",
  "python",
  "java",
]);

/** File types with a dedicated test-tag strategy (`src/tags/strategies/`) — a framework-aware
 *  applier, not the generic path-glob fallback. */
export const TEST_TAG_STRATEGY_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "typescript",
  "javascript",
  "python",
  "go",
  "java",
  "groovy",
  "kotlin",
  "scala",
  "gherkin",
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

/** How completely a single analysis axis is implemented for one language:
 *  - `"full"` — implemented with language-aware handling; results are call/symbol-level accurate.
 *  - `"partial"` — implemented but known-lossy (index-based resolution, module-level exports,
 *    constructor-only call edges, heuristic categories, the generic token duplicate pipeline).
 *  - `"none"` — not implemented, or not applicable to this language. */
export type FidelityLevel = "full" | "partial" | "none";

/** Per-language fidelity across every precision-relevant analysis axis. The four axes backed by
 *  a `*_TYPES` set above are kept in exact sync with it by a test; the rest are a maintained
 *  judgement, cross-checked against `docs/language-support.md`. */
export interface LanguageFidelity {
  /** Raw import/require specifiers → resolved graph edges. */
  importResolution: FidelityLevel;
  /** `FileNode.exports` populated with named symbols. Backed by {@link EXPORT_TRACKING_TYPES}. */
  exportSymbols: FidelityLevel;
  /** `ImportEdge.symbols` — which names each import pulls in. Backed by {@link IMPORT_SYMBOL_TYPES}. */
  importSymbols: FidelityLevel;
  /** Function-level call edges (`FileNode.callEdges`). Backed by {@link CALL_EDGE_TYPES}. */
  callEdges: FidelityLevel;
  /** Per-function + file-level complexity. Backed by {@link FUNCTION_COMPLEXITY_TYPES}. */
  complexity: FidelityLevel;
  /** Accuracy of the `logic`/`ui`/`test`/`config`/… category classification. */
  category: FidelityLevel;
  /** Duplicate detection: `"full"` = language-aware structural comparator (CSS family),
   *  `"partial"` = the generic cross-language token pipeline (the norm — works, no language
   *  semantics), `"none"` = not scanned. */
  duplication: FidelityLevel;
  /** A framework-aware test-tag strategy. Backed by {@link TEST_TAG_STRATEGY_TYPES}. */
  testTags: FidelityLevel;
}

/** Positional constructor for a {@link LanguageFidelity} row — keeps the table below readable. */
function f(
  importResolution: FidelityLevel,
  exportSymbols: FidelityLevel,
  importSymbols: FidelityLevel,
  callEdges: FidelityLevel,
  complexity: FidelityLevel,
  category: FidelityLevel,
  duplication: FidelityLevel,
  testTags: FidelityLevel,
): LanguageFidelity {
  return {
    importResolution,
    exportSymbols,
    importSymbols,
    callEdges,
    complexity,
    category,
    duplication,
    testTags,
  };
}

/**
 * Authoritative per-language fidelity matrix — see `docs/language-support.md` for the same table
 * with per-language known-limitations prose and ADR links, and `docs/known_issues/08-cross-language-reliability.md`
 * for the plan this closes the first slice of. Every {@link FileType} has an entry.
 */
export const LANGUAGE_FIDELITY: Record<FileType, LanguageFidelity> = {
  typescript: f("full", "full", "full", "full", "full", "full", "partial", "full"),
  javascript: f("full", "full", "full", "full", "full", "full", "partial", "full"),
  python: f("full", "partial", "partial", "full", "full", "partial", "partial", "full"),
  go: f("full", "partial", "none", "full", "full", "partial", "partial", "full"),
  java: f("partial", "partial", "partial", "partial", "full", "partial", "partial", "full"),
  kotlin: f("partial", "partial", "partial", "none", "none", "partial", "partial", "full"),
  scala: f("partial", "partial", "partial", "none", "none", "partial", "partial", "full"),
  groovy: f("partial", "partial", "partial", "none", "none", "partial", "partial", "full"),
  coffeescript: f("partial", "partial", "none", "none", "none", "partial", "partial", "none"),
  livescript: f("partial", "none", "none", "none", "none", "partial", "partial", "none"),
  lua: f("partial", "partial", "none", "none", "none", "partial", "partial", "none"),
  css: f("full", "none", "none", "none", "none", "full", "full", "none"),
  scss: f("full", "partial", "none", "none", "none", "full", "full", "none"),
  less: f("full", "partial", "none", "none", "none", "full", "full", "none"),
  stylus: f("full", "none", "none", "none", "none", "full", "partial", "none"),
  gherkin: f("none", "none", "none", "none", "none", "full", "partial", "full"),
  markdown: f("partial", "none", "none", "none", "none", "full", "partial", "none"),
  unknown: f("none", "none", "none", "none", "none", "none", "none", "none"),
};

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

/**
 * Per-language, per-axis explanation of *why* a non-`full` axis is degraded — the prose from
 * `docs/language-support.md`'s "Known limitations" section, keyed for programmatic surfacing in a
 * tool's `caveats`. Only entries that meaningfully inform a caller are listed; any `partial`/
 * `none` axis without an entry falls back to a generic sentence in {@link languageCaveats}.
 */
const FIDELITY_CAVEAT: Partial<Record<FileType, Partial<Record<keyof LanguageFidelity, string>>>> =
  {
    python: {
      exportSymbols: "tracked at module level, not per-symbol",
      importSymbols: "only star imports and re-exports are tracked (ADR-002)",
    },
    go: {
      exportSymbols: "identifier-level, no per-symbol doc/signature",
      importSymbols: "not tracked — per-import symbol resolution is not implemented",
    },
    java: {
      importResolution:
        "index-based: matched by type name across the module, not by resolving the exact package path (ADR-017)",
      exportSymbols: "top-level types only, no field/method-level exports",
      importSymbols:
        "one symbol per import (the FQN's last segment, or the static member for `import static`); wildcard imports carry none, and re-exports aren't tracked",
      callEdges:
        "static calls and constructors only (incl. through generics), not virtual dispatch",
    },
    kotlin: {
      importResolution: "index-based, shared with Java's JvmLangResolver (ADR-017)",
      exportSymbols: "top-level types only",
      importSymbols:
        "one symbol per import (the FQN's last segment); wildcard imports carry none, and re-exports aren't tracked",
      callEdges: "not extracted — Kotlin needs its own grammar (issue 8c)",
      complexity: "not computed — Kotlin needs its own grammar (issue 8c)",
    },
    scala: {
      importResolution:
        "index-based, shared with Java's JvmLangResolver; brace-package imports are a known gap",
      exportSymbols: "top-level types only",
      importSymbols:
        "one symbol per import (the FQN's last segment, brace groups expanded to one edge per member); wildcard imports carry none, and re-exports aren't tracked",
      callEdges: "not extracted — Scala needs its own grammar (issue 8c)",
      complexity: "not computed — Scala needs its own grammar (issue 8c)",
    },
    groovy: {
      importResolution: "index-based, shared with Java's JvmLangResolver",
      exportSymbols: "top-level types only",
      importSymbols:
        "one symbol per import (the FQN's last segment, or the static member for `import static`); wildcard imports carry none, and re-exports aren't tracked",
      callEdges: "not extracted — Groovy needs its own grammar (issue 8c)",
      complexity: "not computed — Groovy needs its own grammar (issue 8c)",
    },
    coffeescript: {
      importResolution: "generic relative-path fallback, no ecosystem-specific rules",
      exportSymbols: "best-effort, less validated than TS/JS",
      callEdges: "not extracted (backfill planned — see the language coverage roadmap)",
      complexity: "not computed (backfill planned — see the language coverage roadmap)",
      testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
    },
    livescript: {
      importResolution: "generic relative-path fallback",
      exportSymbols: "not tracked",
      callEdges: "not extracted (backfill planned)",
      complexity: "not computed (backfill planned)",
      testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
    },
    lua: {
      importResolution: "basic dot-path handling only",
      exportSymbols: "best-effort module-return inspection",
      callEdges: "not extracted (backfill planned)",
      complexity: "not computed (backfill planned)",
      testTags: "no framework-aware strategy — falls back to the generic path-glob applier",
    },
    scss: { exportSymbols: "root-level $/@ variables, mixins and functions only" },
    less: { exportSymbols: "root-level $/@ variables, mixins and functions only" },
    stylus: {
      duplication: "generic token pipeline — no shared PostCSS AST for structural comparison",
    },
    markdown: {
      importResolution: "edges only via code-span file references (`` `src/foo.ts` ``) (ADR-009)",
    },
    gherkin: { importResolution: "feature files have no imports" },
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
    const reason = FIDELITY_CAVEAT[type]?.[axis];
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
