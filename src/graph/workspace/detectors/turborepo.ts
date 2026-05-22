import fs from "node:fs";
import path from "node:path";
import type { MonorepoDetector } from "../registry";

/**
 * @description Turborepo detector. Turborepo is an orchestration layer on top of an
 *   existing package manager — it contributes its type to `MonorepoLayout.types` but
 *   returns no packages itself. Packages are enumerated by the pnpm/yarn/npm detector
 *   that fires alongside it.
 */
export const turborepoDetector: MonorepoDetector = {
  type: "turborepo",
  detect(rootDir) {
    if (!fs.existsSync(path.join(rootDir, "turbo.json"))) return null;
    // Signal presence without contributing packages — other detectors handle that.
    return [];
  },
};
