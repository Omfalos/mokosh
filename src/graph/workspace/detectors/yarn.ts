/** Monorepo detector for Yarn Classic/Berry workspaces (yarn.lock + workspaces field). */
import fs from "node:fs";
import path from "node:path";
import type { MonorepoDetector } from "../registry";
import { resolveGlobPatterns } from "../shared";

/**
 * @description Detects Yarn Classic / Berry workspaces.
 *   Requires both `yarn.lock` and a `package.json` `"workspaces"` field to fire.
 */
export const yarnDetector: MonorepoDetector = {
  type: "yarn",
  detect(rootDir) {
    if (!fs.existsSync(path.join(rootDir, "yarn.lock"))) return null;

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

    const patterns: string[] = Array.isArray(workspaces) ? workspaces : (workspaces.packages ?? []);

    if (patterns.length === 0) return null;
    return resolveGlobPatterns(rootDir, patterns);
  },
};
