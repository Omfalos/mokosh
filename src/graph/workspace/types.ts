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
  /** `true` when `root` lies outside the analyzed `rootDir` (e.g. a Gradle composite build named
   *  via `MokoshConfig.extraRoots` — see `docs/known_issues/22-gradle-composite-build-not-detected.md`).
   *  `relativeRoot` and every node path under this package legitimately start with `..` segments;
   *  this flag exists so callers don't have to re-derive that from the string shape. */
  externalRoot?: boolean;
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
