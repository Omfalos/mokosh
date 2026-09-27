/** Resolves where on-demand coverage runners should look: one root per monorepo package, or the
 *  project root itself for a single-language repo. */
import type { MonorepoLayout } from "../workspace/types";

export interface CoverageScanRoot {
  /** Absolute directory to run coverage tools in. */
  dir: string;
  /** Path prefix (relative to the overall project root, forward-slash separated, `""` for the
   *  root itself) to prepend to every path a runner reports for this root, so the merged result
   *  map is keyed the same way graph nodes are (project-root-relative). */
  relPrefix: string;
}

/**
 * @description Builds the list of directories to scan for coverage: one entry per monorepo
 *   package (optionally narrowed by `packageFilter`), or a single entry at `rootDir` when there
 *   is no monorepo layout (or it detected no packages).
 * @param rootDir - Absolute project/monorepo root.
 * @param layout - A `detectMonorepo` result, or `undefined`/`{ type: "none" }` for a single-language repo.
 * @param packageFilter - Optional allowlist of package names (from `MokoshConfig.coverage.packages`).
 * @returns Scan roots in a stable order (by package name, or the single root).
 */
export function resolveCoverageScanRoots(
  rootDir: string,
  layout: MonorepoLayout | undefined,
  packageFilter?: string[],
): CoverageScanRoot[] {
  if (!layout || layout.type === "none" || layout.packages.length === 0) {
    return [{ dir: rootDir, relPrefix: "" }];
  }
  const allowed = packageFilter ? new Set(packageFilter) : null;
  return layout.packages
    .filter((pkg) => !allowed || allowed.has(pkg.name))
    .sort((a, b) => a.relativeRoot.localeCompare(b.relativeRoot))
    .map((pkg) => ({
      dir: pkg.root,
      relPrefix: pkg.relativeRoot ? `${pkg.relativeRoot.split(/[\\/]/).join("/")}/` : "",
    }));
}
