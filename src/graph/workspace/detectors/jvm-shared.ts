/** Shared helpers for the Gradle and sbt monorepo detectors: JVM source enumeration and package building. */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS } from "../../../const";
import { isDirectory } from "../fs-utils";
import type { WorkspacePackage } from "../types";

/**
 * JVM source extensions a module's graph walk can be seeded from. Mirrors the JVM
 * entries of `DEFAULT_EXTENSIONS` — `.md`/`.feature`/style files are never entry points.
 */
const JVM_SOURCE_EXTENSIONS = new Set([
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".sc",
  ".groovy",
  ".gradle",
]);

const IGNORE_DIRS = new Set(DEFAULT_IGNORE_DIRS);

/**
 * @description Recursively collects every JVM source file under `dir`, skipping the
 *   default ignore directories (`build`, `.gradle`, `target`, `.git`, …). Used to seed
 *   a module's graph walk: JVM modules have no single index file, so every source file
 *   in the module is an entry point.
 * @param {string} dir - Absolute directory to walk.
 * @param {string[]} acc - Accumulator for discovered absolute file paths.
 * @returns {string[]} Absolute paths of all JVM source files found under `dir`.
 */
function collectJvmSources(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
        collectJvmSources(full, acc);
      }
    } else if (
      entry.isFile() &&
      JVM_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * @description Builds a `WorkspacePackage` for a JVM module rooted at `moduleRoot`.
 *   Returns `null` when the directory does not exist or contains no JVM source files
 *   (an `include(...)` entry pointing at a stub or not-yet-created module).
 * @param {string} monorepoRoot - Absolute repo root, used to compute `relativeRoot`.
 * @param {string} moduleRoot - Absolute path to the module directory.
 * @param {string} name - Module name (e.g. Gradle `core:data`, sbt `core`).
 * @returns {WorkspacePackage | null} The built package, or `null` when it has no sources.
 */
export function buildJvmPackage(
  monorepoRoot: string,
  moduleRoot: string,
  name: string,
): WorkspacePackage | null {
  if (!isDirectory(moduleRoot)) return null;
  const entryPoints = collectJvmSources(moduleRoot);
  if (entryPoints.length === 0) return null;

  return {
    name,
    root: moduleRoot,
    relativeRoot: path.relative(monorepoRoot, moduleRoot),
    entryPoints,
  };
}
