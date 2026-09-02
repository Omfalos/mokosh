/** Shared types for lock-file / dependency-metadata parsing across ecosystems. */

/**
 * Represents the parsed dependency-version data mokosh extracts from an ecosystem's lock files
 * or build metadata, used to annotate external import edges with versions.
 */
export interface LockFileData {
  /**
   * Map of package names to their version and nested dependencies. Populated from the JS lock
   * file (npm / Yarn / pnpm).
   */
  dependencies: Record<string, { version: string; dependencies?: Record<string, string> }>;
  /**
   * Third-party JVM dependency versions keyed by Maven **group id** (dotted, e.g.
   * `com.squareup.okhttp3`). Populated from Gradle (version catalog → `gradle.lockfile` →
   * build-script literals) and sbt (`build.sbt` / `project/*.scala` literals) when those files
   * are present. Kept separate from `dependencies` because a JVM import names a fully-qualified
   * type, not a package name, so it is matched to a coordinate by a best-effort
   * longest-group-prefix heuristic rather than an exact lookup.
   */
  jvmDependencies?: Record<string, { version: string }>;
}

/**
 * JS lock file basenames mokosh knows how to parse, in detection priority order. Exported so
 * other features (e.g. `findDuplicates`) can exclude these files by the same single source of
 * truth instead of re-declaring the list — a lock file's repeated JSON/YAML dependency blocks
 * are real textual repetition, but not code duplication.
 */
export const LOCK_FILE_NAMES: readonly string[] = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
];
