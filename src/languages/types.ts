/** Shared shapes for the per-language adapter layer — see `docs/adr-022-language-adapters.md`. */
import type { ModuleRole } from "../graph/responsibility/types";
import type { FileNode } from "../types/node";
import type { FileType } from "../types/parse";

/**
 * Coarse kind of a public export derived from its type signature prefix.
 * Used to distinguish runtime values from type-only exports without parsing the full signature.
 */
export type ExportKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "const"
  | "namespace"
  | "unknown";

/** Structural kind of a type export, as reported by the type graph. */
export type TypeKind = "interface" | "class" | "enum" | "type";

/** Optional per-language behaviour that tools consult instead of switching on the file type. A
 *  missing hook means "use the generic default". Hooks must be cheap and side-effect free. */
export interface LanguageHooks {
  /** Classifies an export from its `signature`. Defaults to the TS/JS keyword-prefix inference. */
  exportKind?(signature: string | undefined): ExportKind;
  /** Picks the public entry points among this language's non-test source files when the project
   *  has no `package.json` convention. `sources` are already filtered to non-test files of this
   *  language's family (or of the language itself when it has none). */
  entryPoints?(sources: readonly FileNode[]): string[];
  /** Names the type kind of an export when it is type-like (class/interface/enum/alias), or
   *  `undefined` for functions and values. Defaults to the TS/JS keyword-prefix rule. */
  typeKind?(signature: string | undefined): TypeKind | undefined;
  /** Fallback role for a file the path-based rules left as `"other"`, from naming conventions. */
  roleHint?(node: FileNode): ModuleRole | undefined;
  /** Reports whether a project-relative path is a test by this language's naming convention. */
  isTestPath?(relPath: string): boolean;
}

/** How completely a single analysis axis is implemented for one language:
 *  - `"full"` — implemented with language-aware handling; results are call/symbol-level accurate.
 *  - `"partial"` — implemented but known-lossy (index-based resolution, module-level exports,
 *    constructor-only call edges, heuristic categories, the generic token duplicate pipeline).
 *  - `"none"` — not implemented, or not applicable to this language. */
export type FidelityLevel = "full" | "partial" | "none";

/** Per-language fidelity across every precision-relevant analysis axis. The axes backed by a
 *  {@link LanguageCapabilities} flag are checked against it by a test; the rest are a maintained
 *  judgement, cross-checked against `docs/language-support.md`. */
export interface LanguageFidelity {
  /** Raw import/require specifiers → resolved graph edges. */
  importResolution: FidelityLevel;
  /** `FileNode.exports` populated with named symbols. Backed by `capabilities.exportSymbols`. */
  exportSymbols: FidelityLevel;
  /** `ImportEdge.symbols` — which names each import pulls in. Backed by `capabilities.importSymbols`. */
  importSymbols: FidelityLevel;
  /** Function-level call edges (`FileNode.callEdges`). Backed by `capabilities.callEdges`. */
  callEdges: FidelityLevel;
  /** Per-function + file-level complexity. Backed by `capabilities.functionComplexity`. */
  complexity: FidelityLevel;
  /** Accuracy of the `logic`/`ui`/`test`/`config`/… category classification. */
  category: FidelityLevel;
  /** Duplicate detection: `"full"` = language-aware structural comparator (CSS family),
   *  `"partial"` = the generic cross-language token pipeline (the norm — works, no language
   *  semantics), `"none"` = not scanned. */
  duplication: FidelityLevel;
  /** A framework-aware test-tag strategy. Backed by `capabilities.testTags`. */
  testTags: FidelityLevel;
}

/** Which graph-analysis capabilities a language's parser feeds. The `*_TYPES` sets exported from
 *  `graph/language-support` are derived from these flags, never maintained by hand. */
export interface LanguageCapabilities {
  /** The parser ever populates `FileNode.exports`. */
  exportSymbols: boolean;
  /** The parser records which named symbols each import edge pulls in (`ImportEdge.symbols`). */
  importSymbols: boolean;
  /** The parser records function-level call edges (`FileNode.callEdges`). */
  callEdges: boolean;
  /** The parser populates per-function complexity plus file-level complexity. */
  functionComplexity: boolean;
  /** `buildTypeGraph` can extract interfaces/classes/enums/aliases from this language. */
  typeGraph: boolean;
  /** A dedicated test-tag strategy exists (`src/tags/strategies/`), not the path-glob fallback. */
  testTags: boolean;
}

/** Languages that share behaviour (resolver package model, dependency metadata, conventions). */
export type LanguageFamily = "js" | "jvm" | "style";

/**
 * The single registration unit for a language: what it is (`type`, `extensions`, `family`) and what
 * mokosh's analysis can extract from it (`capabilities`, `fidelity`, `caveats`). Adapters are pure
 * data — they import no parser or resolver — so the registry is cheap and safe to load in worker
 * threads. Parsers stay registered in `src/parser.ts`.
 */
export interface LanguageAdapter {
  type: FileType;
  family?: LanguageFamily;
  /** Lower-case extensions (with the dot) that map to `type`. */
  extensions: readonly string[];
  capabilities: LanguageCapabilities;
  fidelity: LanguageFidelity;
  /** Per-axis explanation of *why* a non-`full` axis is degraded, surfaced in tool `caveats`. */
  caveats?: Partial<Record<keyof LanguageFidelity, string>>;
  hooks?: LanguageHooks;
}
