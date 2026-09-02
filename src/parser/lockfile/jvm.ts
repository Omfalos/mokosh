/** Discovers and merges JVM dependency-version metadata (Gradle + sbt) for a project root. */
import fs from "node:fs";
import path from "node:path";
import { parseGradleBuildScript, parseGradleLockfile, parseGradleVersionCatalog } from "./gradle";
import { parseSbtBuild } from "./sbt";

/** Directory names skipped when shallow-walking for Gradle/sbt build files. */
const JVM_DEP_IGNORE_DIRS = new Set(["node_modules", "build", ".gradle", "target", ".git", "dist"]);

/** Maximum depth for the shallow walk that finds per-module `build.gradle*` / `gradle.lockfile`. */
const JVM_DEP_SCAN_DEPTH = 2;

/**
 * @description Reads a file, returning `null` on any error (missing, unreadable).
 */
function readFileOrNull(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null;
  } catch {
    return null;
  }
}

/**
 * @description Loads third-party JVM dependency versions from Gradle and sbt metadata under
 * `rootDir`. Sources are merged in priority order — Gradle version catalog, then
 * `gradle.lockfile`s, then `build.gradle*` literals, then sbt `build.sbt` / `project/*.scala`
 * literals — with the first source to name a group id winning. `build.gradle*` and
 * `gradle.lockfile` are discovered by a shallow walk (depth ≤ 2) so per-module Android layouts
 * are covered without a full project traversal.
 * @param rootDir - The project root directory.
 * @returns Map of Maven group id to `{ version }`, or `null` when no JVM metadata is found.
 */
export function loadJvmDependencies(rootDir: string): Record<string, { version: string }> | null {
  const merged: Record<string, string> = {};
  const add = (deps: Record<string, string>): void => {
    for (const [group, version] of Object.entries(deps)) {
      if (!merged[group] && version) merged[group] = version;
    }
  };

  const catalog = readFileOrNull(path.join(rootDir, "gradle", "libs.versions.toml"));
  if (catalog) add(parseGradleVersionCatalog(catalog));

  const lockfiles: string[] = [];
  const buildScripts: string[] = [];
  const sbtFiles: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          depth < JVM_DEP_SCAN_DEPTH &&
          !entry.name.startsWith(".") &&
          !JVM_DEP_IGNORE_DIRS.has(entry.name)
        ) {
          walk(abs, depth + 1);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name === "gradle.lockfile") lockfiles.push(abs);
      else if (entry.name === "build.gradle" || entry.name === "build.gradle.kts")
        buildScripts.push(abs);
      else if (entry.name === "build.sbt") sbtFiles.push(abs);
    }
  };
  walk(rootDir, 0);

  for (const file of lockfiles) {
    const content = readFileOrNull(file);
    if (content) add(parseGradleLockfile(content));
  }
  for (const file of buildScripts) {
    const content = readFileOrNull(file);
    if (content) add(parseGradleBuildScript(content));
  }
  for (const file of sbtFiles) {
    const content = readFileOrNull(file);
    if (content) add(parseSbtBuild(content));
  }

  try {
    const projectDir = path.join(rootDir, "project");
    for (const entry of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".scala")) {
        const content = readFileOrNull(path.join(projectDir, entry.name));
        if (content) add(parseSbtBuild(content));
      }
    }
  } catch {
    // No project/ directory — not an sbt build.
  }

  const groups = Object.keys(merged);
  if (groups.length === 0) return null;
  const result: Record<string, { version: string }> = {};
  for (const group of groups) result[group] = { version: merged[group] as string };
  return result;
}
