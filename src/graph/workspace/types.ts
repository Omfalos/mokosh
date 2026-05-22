/** @description Metadata for a single package inside a monorepo workspace. */
export interface WorkspacePackage {
  /** Package name from `package.json`. */
  name: string;
  /** Absolute path to the package directory. */
  root: string;
  /** Path relative to the monorepo root (used as a stable key in node paths). */
  relativeRoot: string;
  /** Resolved entry point absolute paths, in priority order. */
  entryPoints: string[];
}

/** @description Result returned by `detectMonorepo` describing the workspace layout. */
export interface MonorepoLayout {
  root: string;
  /** Primary detected tool (first detector that fired), or `"none"`. */
  type: string;
  /** All tools detected in this repo (e.g. `["turborepo", "pnpm"]` for a Turborepo+pnpm repo). */
  types: string[];
  packages: WorkspacePackage[];
  packageMap: Map<string, WorkspacePackage>;
}
