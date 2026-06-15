/** Public types for the responsibility-graph subsystem. Kept separate to avoid circular imports between infer-role.ts and index.ts. */

/**
 * Semantic role of a module derived from its file path and category.
 * Roles are intentionally generic so they apply across any project layout.
 */
export type ModuleRole =
  | "test"
  | "config"
  | "types"
  | "model"
  | "service"
  | "controller"
  | "middleware"
  | "router"
  | "component"
  | "store"
  | "util"
  | "handler"
  | "cli"
  | "api"
  | "parser"
  | "builder"
  | "resolver"
  | "adapter"
  | "plugin"
  | "other";

/**
 * What a single module is responsible for, derived purely from graph data.
 * No inference or hallucination — only data already present in the `FileNode`.
 */
export interface ModuleResponsibility {
  /** Project-relative file path. */
  path: string;
  /** Coarse semantic role inferred from file path and category. */
  role: ModuleRole;
  /**
   * Human-readable description extracted from the file's leading JSDoc comment.
   * `undefined` when the file has no file-level JSDoc.
   */
  description?: string;
  /** Names of all exported symbols (functions, types, classes). */
  exports: string[];
  /**
   * Name of the feature hub this file belongs to, if any.
   * Derived from `buildFeatureGraph` with default threshold.
   */
  featureHub?: string;
}

/**
 * Map from project-relative path to its responsibility record.
 * A token-efficient answer to "what does module X do?" across many files at once.
 */
export type ResponsibilityGraph = Map<string, ModuleResponsibility>;
