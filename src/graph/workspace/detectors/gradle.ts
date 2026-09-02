/** Monorepo detector for Gradle multi-module builds (settings.gradle include(...)). */
import fs from "node:fs";
import path from "node:path";
import type { MonorepoDetector } from "../registry";
import type { WorkspacePackage } from "../types";
import { buildJvmPackage } from "./jvm-shared";

/** Strips line and block comments so `include` scanning ignores commented-out modules. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * @description Parses Gradle project paths out of a `settings.gradle(.kts)` file. Every
 *   `include`d module is written as a quoted colon-prefixed path (`":core:data"`), in both
 *   the Groovy (`include ':a', ':b'`) and Kotlin-DSL (`include(":a", ":b")`) forms, so a
 *   scan for quoted `:`-prefixed tokens captures them regardless of call syntax or line
 *   wrapping. `includeBuild(...)` (composite builds) uses filesystem paths, not `:` paths,
 *   so it is naturally excluded.
 * @param {string} source - Raw `settings.gradle(.kts)` contents.
 * @returns {string[]} Unique Gradle project paths without the leading colon (e.g. `core:data`).
 */
function parseIncludes(source: string): string[] {
  const stripped = stripComments(source);
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/['"](:[A-Za-z0-9_\-.:]+)['"]/g)) {
    const projectPath = (match[1] as string).replace(/^:/, "").replace(/:$/, "");
    if (projectPath) seen.add(projectPath);
  }
  return [...seen];
}

/**
 * @description Detects Gradle multi-module builds via `settings.gradle` / `settings.gradle.kts`.
 *   Each `include(":core:data")` becomes a `WorkspacePackage` rooted at `<root>/core/data`
 *   (Gradle's default project-path → directory mapping). Modules with a non-standard
 *   `projectDir` override are not relocated — a documented limitation (ADR-017).
 *
 *   Returns `null` (detector does not fire, repo builds as one flat graph) when no
 *   `settings.gradle*` exists or it declares no `include`d modules — a single-module
 *   Gradle build is not a workspace.
 */
export const gradleDetector: MonorepoDetector = {
  type: "gradle",
  detect(rootDir) {
    const settingsPath = ["settings.gradle.kts", "settings.gradle"]
      .map((name) => path.join(rootDir, name))
      .find((candidate) => fs.existsSync(candidate));
    if (!settingsPath) return null;

    let source: string;
    try {
      source = fs.readFileSync(settingsPath, "utf-8");
    } catch {
      return null;
    }

    const projectPaths = parseIncludes(source);
    if (projectPaths.length === 0) return null;

    const packages: WorkspacePackage[] = [];
    for (const projectPath of projectPaths) {
      const moduleRoot = path.join(rootDir, ...projectPath.split(":"));
      const pkg = buildJvmPackage(rootDir, moduleRoot, projectPath);
      if (pkg) packages.push(pkg);
    }
    return packages.length > 0 ? packages : null;
  },
};
