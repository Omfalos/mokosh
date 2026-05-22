import fs from "node:fs";
import path from "node:path";
import type { MonorepoDetector } from "../registry";
import { resolveGlobPatterns } from "../shared";

/**
 * @description Detects npm workspaces via `package.json` `"workspaces"` field.
 *   Yields to the yarn detector when `yarn.lock` is present in the same root.
 */
export const npmDetector: MonorepoDetector = {
  type: "npm",
  detect(rootDir) {
    const pkgPath = path.join(rootDir, "package.json");
    if (!fs.existsSync(pkgPath)) return null;

    let workspaces: string[] | { packages?: string[] } | undefined;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        workspaces?: string[] | { packages?: string[] };
      };
      workspaces = pkg.workspaces;
    } catch {
      return null;
    }

    if (!workspaces) return null;

    // Skip if yarn.lock present — yarn detector handles that repo
    if (fs.existsSync(path.join(rootDir, "yarn.lock"))) return null;

    const patterns: string[] = Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []);

    if (patterns.length === 0) return null;
    return resolveGlobPatterns(rootDir, patterns);
  },
};
