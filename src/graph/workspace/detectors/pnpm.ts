/** Monorepo detector for pnpm workspaces (pnpm-workspace.yaml). */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { MonorepoDetector } from "../registry";
import { resolveGlobPatterns } from "../shared";

/**
 * @description Detects pnpm workspaces via `pnpm-workspace.yaml`.
 *   Reads the `packages:` glob list and resolves each pattern to `WorkspacePackage` entries.
 */
export const pnpmDetector: MonorepoDetector = {
  type: "pnpm",
  detect(rootDir) {
    const yamlPath = path.join(rootDir, "pnpm-workspace.yaml");
    if (!fs.existsSync(yamlPath)) return null;

    let patterns: string[] = [];
    try {
      const parsed = yaml.load(fs.readFileSync(yamlPath, "utf-8")) as {
        packages?: string[];
      } | null;
      patterns = parsed?.packages ?? [];
    } catch {
      return null;
    }

    return resolveGlobPatterns(rootDir, patterns);
  },
};
