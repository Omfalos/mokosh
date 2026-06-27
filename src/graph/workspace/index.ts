/** Runs all registered monorepo detectors and returns the layout describing the detected tool and packages. */
import path from "node:path";
import { npmDetector } from "./detectors/npm";
import { nxDetector } from "./detectors/nx";
import { pnpmDetector } from "./detectors/pnpm";

import { turborepoDetector } from "./detectors/turborepo";
import { yarnDetector } from "./detectors/yarn";
import type { MonorepoDetector } from "./registry";
import { getMonorepoDetectors, registerMonorepoDetector } from "./registry";
import type { MonorepoLayout, WorkspacePackage } from "./types";

// Register in priority order: orchestration tools first, then package managers.
registerMonorepoDetector(turborepoDetector);
registerMonorepoDetector(nxDetector);
registerMonorepoDetector(pnpmDetector);
registerMonorepoDetector(yarnDetector);
registerMonorepoDetector(npmDetector);

/**
 * @description Runs all registered monorepo detectors against `rootDir` and merges
 *   their results into a single `MonorepoLayout`. All matching detectors contribute
 *   their `type` string and packages — so a Turborepo + pnpm repo will have
 *   `types: ["turborepo", "pnpm"]` and packages from the pnpm detector.
 *
 *   Packages are deduplicated by name: the first detector to emit a package name wins.
 *   Returns `type: "none"` when no detector fires.
 */
export function detectMonorepo(
  rootDir: string,
  detectors: readonly MonorepoDetector[] = getMonorepoDetectors(),
): MonorepoLayout {
  const abs = path.resolve(rootDir);
  const allPackages = new Map<string, WorkspacePackage>();
  const detectedTypes: string[] = [];

  for (const detector of detectors) {
    const pkgs = detector.detect(abs);
    if (pkgs === null) continue;
    detectedTypes.push(detector.type);
    for (const pkg of pkgs) {
      if (!allPackages.has(pkg.name)) allPackages.set(pkg.name, pkg);
    }
  }

  if (detectedTypes.length === 0) {
    return { root: abs, type: "none", types: [], packages: [], packageMap: new Map() };
  }

  const packages = Array.from(allPackages.values());
  return {
    root: abs,
    type: detectedTypes[0] as string,
    types: detectedTypes,
    packages,
    packageMap: new Map(packages.map((pkg) => [pkg.name, pkg])),
  };
}

export type { MonorepoDetector } from "./registry";
export { registerMonorepoDetector } from "./registry";
export type { MonorepoLayout, WorkspacePackage } from "./types";
