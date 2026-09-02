/** Monorepo detector for sbt multi-project builds (build.sbt project definitions). */
import fs from "node:fs";
import path from "node:path";
import type { MonorepoDetector } from "../registry";
import type { WorkspacePackage } from "../types";
import { buildJvmPackage } from "./jvm-shared";

/** Strips line and block comments so project scanning ignores commented-out definitions. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

interface SbtProject {
  name: string;
  /** Directory relative to the repo root, from `file("...")` or the `val` name. */
  dir: string;
}

/**
 * @description Parses sbt sub-project definitions out of a build definition. Recognises
 *   `lazy val <name> = project` (and the non-`lazy` form), with an optional
 *   `.in(file("<path>"))` / `in file("<path>")` locator. When no `file(...)` is given sbt
 *   defaults the directory to the `val` name. The root aggregate
 *   (`project in file(".")`) is dropped — it is the repo root, not a sub-module.
 * @param {string} source - Raw `build.sbt` (or `project/*.scala`) contents.
 * @returns {SbtProject[]} One entry per sub-project, deduplicated by directory.
 */
function parseProjects(source: string): SbtProject[] {
  const stripped = stripComments(source);
  const byDir = new Map<string, SbtProject>();

  for (const match of stripped.matchAll(
    /(?:lazy\s+)?val\s+([A-Za-z0-9_]+)\s*=\s*\(?\s*project\b([^\n]*)/g,
  )) {
    const name = match[1] as string;
    const tail = match[2] as string;
    const fileMatch = tail.match(/\bfile\s*\(\s*["']([^"']+)["']\s*\)/);
    const dir = fileMatch ? (fileMatch[1] as string) : name;
    if (dir === "." || dir === "./") continue; // root aggregate, not a module
    const normalized = dir.replace(/^\.\//, "").replace(/\/$/, "");
    if (!byDir.has(normalized)) byDir.set(normalized, { name, dir: normalized });
  }

  return [...byDir.values()];
}

/**
 * @description Detects sbt multi-project builds. Fires when both `build.sbt` and a
 *   `project/` directory are present, then parses sub-project definitions from `build.sbt`
 *   and any `project/*.scala` build-support files. Each becomes a `WorkspacePackage` rooted
 *   at its `file("...")` directory (or the `val` name when omitted).
 *
 *   Returns `null` (repo builds as one flat graph) when the layout is not sbt or declares
 *   no sub-projects beyond the root aggregate — a single-project sbt build is not a workspace.
 */
export const sbtDetector: MonorepoDetector = {
  type: "sbt",
  detect(rootDir) {
    const buildSbt = path.join(rootDir, "build.sbt");
    const projectDir = path.join(rootDir, "project");
    if (!fs.existsSync(buildSbt) || !fs.existsSync(projectDir)) return null;

    const sources: string[] = [];
    try {
      sources.push(fs.readFileSync(buildSbt, "utf-8"));
    } catch {
      return null;
    }
    try {
      for (const entry of fs.readdirSync(projectDir)) {
        if (entry.endsWith(".scala")) {
          sources.push(fs.readFileSync(path.join(projectDir, entry), "utf-8"));
        }
      }
    } catch {
      /* project/ unreadable — build.sbt alone is enough */
    }

    const seen = new Set<string>();
    const projects: SbtProject[] = [];
    for (const source of sources) {
      for (const project of parseProjects(source)) {
        if (!seen.has(project.dir)) {
          seen.add(project.dir);
          projects.push(project);
        }
      }
    }
    if (projects.length === 0) return null;

    const packages: WorkspacePackage[] = [];
    for (const project of projects) {
      const moduleRoot = path.join(rootDir, ...project.dir.split("/"));
      const pkg = buildJvmPackage(rootDir, moduleRoot, project.name);
      if (pkg) packages.push(pkg);
    }
    return packages.length > 0 ? packages : null;
  },
};
