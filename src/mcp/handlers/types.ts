import type { ApiSurface, ApiSurfaceSummary, CycleEdgeKind, TagKind } from "../../index";

export type AnalyzeArgs = {
  root: string;
  entryPoints: string[];
  /** Monorepo only: build every package graph before returning, instead of the fast
   *  layout-only response. Restores the pre-progressive `{ nodeCount, categories, cycles }`
   *  payload. Ignored for single-package roots. */
  eager?: boolean;
  /** Monorepo only: restrict the (eager or lazily-triggered) build to these package names
   *  or relative roots — the escape hatch for very large monorepos. */
  packages?: string[];
  /** Cycle edge kinds to include that are otherwise filtered from the `cycles` output:
   *  `"docReference"` (Markdown doc cross-links), `"samePackage"` (JVM same-package siblings).
   *  Default: none. */
  cycleKinds?: CycleEdgeKind[];
};

export type GetWorkspacePackagesArgs = { root: string };

export type GetWorkspaceAffectedArgs = {
  root: string;
  file: string;
  maxFilesPerPackage?: number;
};

export type GetDependenciesArgs = {
  root: string;
  file: string;
  depth?: number;
  withMeta?: boolean;
};

export type GetDependentsArgs = { root: string; file: string; withMeta?: boolean };

export type GetAffectedArgs = {
  root: string;
  file: string;
  testsOnly?: boolean;
  cached?: boolean;
  changedSymbols?: string[];
  withMeta?: boolean;
};

export type CompareBranchesArgs = {
  root: string;
  baseRef: string;
  headRef?: string;
  entryPoints?: string[];
  minDuplicateLines?: number;
  complexityMetric?: "cognitiveComplexity" | "complexity";
  complexityThreshold?: number;
  maxCoveragePct?: number;
  detail?: "summary" | "full";
  maxItems?: number;
};

export type GetCallersArgs = {
  root: string;
  file: string;
  depth?: number;
  withEdgeDetail?: boolean;
};

export type FindSymbolArgs = { root: string; name: string; package?: string };

export type FindUnusedArgs = { root: string; entryPoints?: string[]; package?: string };

export type FindUncoveredArgs = { root: string; coverageThreshold?: number; package?: string };

export type ListTagsArgs = {
  root: string;
  package?: string;
  /** Restrict to one tag kind, or `"all"`. Default: the query-meaningful kinds
   *  (`comment-marker`, `import`). */
  kind?: TagKind | "all";
  /** Case-insensitive substring match on the tag name. */
  prefix?: string;
  /** Minimum node count for a tag to appear. Default 2. */
  minCount?: number;
  /** Max tags returned. Default 100; hard-capped at 250 whatever the value. */
  limit?: number;
};

export type CheckDocDriftArgs = { root: string; package?: string };

export type FindComplexFunctionsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  threshold?: number;
  limit?: number;
  package?: string;
};

export type FindRiskHotspotsArgs = {
  root: string;
  metric?: "cognitiveComplexity" | "complexity";
  minComplexity?: number;
  maxCoveragePct?: number;
  minChurn?: number;
  limit?: number;
  package?: string;
};

export type FindDuplicatesArgs = {
  root: string;
  minLines?: number;
  ignoreLiterals?: boolean;
  maxPunctuationRatio?: number;
  limit?: number;
  ignoreDirs?: string[];
  includeGenerated?: boolean;
  includeSameFile?: boolean;
  includeSvgMarkup?: boolean;
  includeDocs?: boolean;
  scope?: "src" | "tests" | "all";
  /** `key:value` result filter — see `src/query/dup-parser.ts` / `DuplicateQuery`. */
  filter?: string;
  /** Which lists the response carries. `"summary"` (default) → `summary` + a small `clusters`
   *  preview + a `hint`, no `groups`; a `filter` with no `view` → `summary` + matching
   *  `clusters` only. `"groups"` → `summary` + raw `groups` (the per-span shape), no `clusters`.
   *  `"full"` → both, with `groups` de-duped against the returned multi-member clusters. */
  view?: "summary" | "groups" | "full";
  /** Compact response shape (default true): per-group `{ lines, score, family, kind, defKind,
   *  occurrences: ["path:start-end"], signals }` and per-cluster metadata (incl. `longestMatchAt`)
   *  without nested group bodies. `false` returns the full objects. */
  slim?: boolean;
  package?: string;
};

export type ProposeTagsArgs = {
  root: string;
  changedFiles?: string[];
  /** Diff against this ref (e.g. "origin/main") instead of only local working-tree/staged/
   *  untracked changes. Ignored when `changedFiles` is given. Needed in CI, where the checkout
   *  is already clean and there's nothing local left to diff. */
  base?: string;
  featureThreshold?: number;
  format?: "tags" | "paths";
};

export type DetectFeaturesArgs = {
  root: string;
  entryPoints?: string[];
  featureThreshold?: number;
  package?: string;
  /** Max hubs returned (default 50); the true total is always reported as `matched`. */
  limit?: number;
};

export type QueryArgs = {
  root: string;
  entryPoints?: string[];
  filter: string;
  mermaid?: boolean;
  slim?: boolean;
  package?: string;
};

export type ClearCacheArgs = { root: string };

export type GetTypeGraphArgs = {
  root: string;
  type?: string;
  package?: string;
  /** Inventory only: max types listed (default 100). */
  limit?: number;
  /** Inventory only: keep one structural kind. */
  kind?: "interface" | "class" | "enum" | "type";
  /** Inventory only: keep types whose file path contains this substring. */
  path?: string;
};

export type GetModuleResponsibilityArgs = {
  root: string;
  paths?: string[];
  minOutDegree?: number;
  package?: string;
};

export type GetFeatureGraphArgs = {
  root: string;
  minOutDegree?: number;
  package?: string;
  /** `"summary"` (default): per-feature counts, no file lists. `"full"`: every owned file + `unassigned`. */
  view?: "summary" | "full";
  /** `view:"summary"` only: max features listed (default 30). */
  limit?: number;
  /** Return the full file list for this one feature (name as shown in the summary). */
  feature?: string;
};

export type GetCallGraphArgs = {
  root: string;
  function: string;
  package?: string;
  /** Narrow the definition search to this one path; bypasses the ambiguity path entirely. */
  file?: string;
  /** Include the full `candidates: string[]` list when the name is ambiguous (default false). */
  includeCandidates?: boolean;
};

export type GetApiSurfaceArgs = {
  root: string;
  entryPoints?: string[];
  package?: string;
  maxExportsPerPackage?: number;
  /**
   * Shape of the single-surface response (plain root, or a single requested `package`).
   * `"summary"` (default) → token-bounded {@link ApiSurfaceSummary}: counts, a capped
   * `{name,kind}` export sample, `byKind`, and the (short) `unreachableFromEntry` list.
   * `"exports"` → the summary plus the full `publicExports` array (docs, signatures, definedIn).
   * `"full"` → the complete {@link ApiSurface} (all export detail + every path list).
   * Ignored by the compact multi-package breakdown.
   */
  view?: "summary" | "exports" | "full";
  /** `view:"summary"` only: cap the `publicExports` sample (default 30). */
  maxExports?: number;
};

export type ApplyTagsArgs = {
  root: string;
  dryRun?: boolean;
  package?: string;
  /** Return the full per-file list, including unchanged files (default false: counts + errors + a sample). */
  verbose?: boolean;
};

export type ToolArgs =
  | AnalyzeArgs
  | GetDependenciesArgs
  | GetDependentsArgs
  | GetAffectedArgs
  | CompareBranchesArgs
  | GetCallersArgs
  | FindSymbolArgs
  | FindUnusedArgs
  | FindUncoveredArgs
  | ListTagsArgs
  | CheckDocDriftArgs
  | FindComplexFunctionsArgs
  | FindRiskHotspotsArgs
  | FindDuplicatesArgs
  | ProposeTagsArgs
  | DetectFeaturesArgs
  | QueryArgs
  | ClearCacheArgs
  | GetTypeGraphArgs
  | GetModuleResponsibilityArgs
  | GetFeatureGraphArgs
  | GetCallGraphArgs
  | GetApiSurfaceArgs
  | ApplyTagsArgs;
