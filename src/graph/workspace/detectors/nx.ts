/** Monorepo detector for Nx workspaces (nx.json + project.json files). */
import fs from "node:fs";
import path from "node:path";
import { isFile } from "../fs-utils";
import type { MonorepoDetector } from "../registry";
import type { WorkspacePackage } from "../types";

/**
 * @description Detects Nx workspaces by scanning for `project.json` files under `nx.json`.
 *   Supports both package-based repos (with per-project `package.json`) and integrated repos
 *   (no per-project `package.json` — name taken from `project.json`).
 */
export const nxDetector: MonorepoDetector = {
  type: "nx",
  detect(rootDir) {
    if (!fs.existsSync(path.join(rootDir, "nx.json"))) return null;

    const seen = new Set<string>();
    return walkForProjectJsonDirs(rootDir, rootDir, seen, 0)
      .map((pkgRoot) => buildNxPackage(rootDir, pkgRoot, path.join(pkgRoot, "project.json")))
      .filter((pkg): pkg is WorkspacePackage => pkg !== null);
  },
};

/**
 * @description Recursively walks `dir` up to 4 levels deep and returns absolute paths
 *   of directories that contain a `project.json`. Skips `node_modules`, `.nx`, `dist`, and
 *   hidden directories. Each directory is returned at most once via `seen`.
 * @param {string} rootDir - The monorepo root; unused in the recursion but kept for future use.
 * @param {string} dir - The directory to walk in this recursion step.
 * @param {Set<string>} seen - Set of already-returned absolute paths; updated in place.
 * @param {number} depth - Current recursion depth; returns early when greater than 4.
 * @returns {string[]} Absolute paths of all directories containing `project.json` under `dir`.
 */
function walkForProjectJsonDirs(
  rootDir: string,
  dir: string,
  seen: Set<string>,
  depth: number,
): string[] {
  if (depth > 4) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith(".") || name === "node_modules" || name === "dist" || name === ".nx")
      continue;
    const fullPath = path.join(dir, name);
    if (fs.existsSync(path.join(fullPath, "project.json")) && !seen.has(fullPath)) {
      seen.add(fullPath);
      found.push(fullPath);
    } else {
      found.push(...walkForProjectJsonDirs(rootDir, fullPath, seen, depth + 1));
    }
  }
  return found;
}

type NxProjectJson = {
  name?: string;
  sourceRoot?: string;
  targets?: {
    build?: {
      options?: { main?: string; entryFile?: string };
    };
  };
};

/**
 * @description Builds a `WorkspacePackage` from an Nx `project.json`.
 *   If a `package.json` is also present, its `name`, `main`, and `exports` fields take priority
 *   over `project.json` — supporting both integrated and package-based Nx repos.
 * @param {string} monorepoRoot - Absolute monorepo root, used to compute `relativeRoot`.
 * @param {string} pkgRoot - Absolute path to the project directory.
 * @param {string} projJsonPath - Absolute path to the `project.json` file to read.
 * @returns {WorkspacePackage | null} The built package, or `null` when no usable name can be determined.
 */
function buildNxPackage(
  monorepoRoot: string,
  pkgRoot: string,
  projJsonPath: string,
): WorkspacePackage | null {
  let projJson: NxProjectJson = {};
  try {
    projJson = JSON.parse(fs.readFileSync(projJsonPath, "utf-8")) as NxProjectJson;
  } catch {
    return null;
  }

  let name = projJson.name;
  let pkgMain: string | undefined;
  let pkgExports: unknown;

  const pkgJsonPath = path.join(pkgRoot, "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
        name?: string;
        main?: string;
        exports?: unknown;
      };
      name = pkgJson.name ?? name;
      pkgMain = pkgJson.main;
      pkgExports = pkgJson.exports;
    } catch {
      /* use project.json values */
    }
  }

  if (!name) return null;

  return {
    name,
    root: pkgRoot,
    relativeRoot: path.relative(monorepoRoot, pkgRoot),
    entryPoints: resolveNxEntryPoints(pkgRoot, projJson, pkgMain, pkgExports),
  };
}

/**
 * @description Derives entry point paths for an Nx project in priority order:
 *   `targets.build.options.main` → `package.json` exports/main → `sourceRoot/index.ts`
 *   → common `src/index.ts` conventions. Returns the first existing file, or the first candidate
 *   as a fallback when nothing exists on disk.
 * @param {string} pkgRoot - Absolute path to the project directory.
 * @param {NxProjectJson} projJson - Parsed `project.json` contents.
 * @param {string} [pkgMain] - The `main` field from `package.json`, if present.
 * @param {unknown} [pkgExports] - The `exports` field from `package.json`, if present.
 * @returns {string[]} A single-element array with the resolved entry point absolute path.
 */
function resolveNxEntryPoints(
  pkgRoot: string,
  projJson: NxProjectJson,
  pkgMain?: string,
  pkgExports?: unknown,
): string[] {
  const candidates: string[] = [];

  const buildMain =
    projJson.targets?.build?.options?.main ?? projJson.targets?.build?.options?.entryFile;
  if (buildMain) {
    const repoRootGuess = path.resolve(pkgRoot, "../..");
    candidates.push(path.resolve(repoRootGuess, buildMain));
    candidates.push(path.resolve(pkgRoot, buildMain));
  }

  if (pkgExports) {
    const exp = pkgExports;
    if (typeof exp === "string") candidates.push(path.join(pkgRoot, exp));
    else if (typeof exp === "object" && exp !== null) {
      const dot = (exp as Record<string, unknown>)["."];
      if (typeof dot === "string") candidates.push(path.join(pkgRoot, dot));
    }
  }
  if (pkgMain) candidates.push(path.join(pkgRoot, pkgMain));

  if (projJson.sourceRoot) {
    const repoRootGuess = path.resolve(pkgRoot, "../..");
    const srcRoot = path.resolve(repoRootGuess, projJson.sourceRoot);
    candidates.push(path.join(srcRoot, "index.ts"), path.join(srcRoot, "index.tsx"));
  }

  for (const c of ["src/index.ts", "src/index.tsx", "index.ts", "index.tsx"]) {
    candidates.push(path.join(pkgRoot, c));
  }

  const existing = candidates.filter(isFile);
  return existing.length > 0 ? existing.slice(0, 1) : candidates.slice(0, 1);
}
