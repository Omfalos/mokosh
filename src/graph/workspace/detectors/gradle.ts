/** Monorepo detector for Gradle multi-module builds (settings.gradle include(...)). */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS } from "../../../const";
import type { MonorepoDetector } from "../registry";
import type { WorkspacePackage } from "../types";
import { buildJvmPackage } from "./jvm-shared";

const IGNORE_DIR_SET = new Set(DEFAULT_IGNORE_DIRS);

/** Bound on how deep {@link indexDirectoriesByBasename} walks — generous enough for any real
 *  module layout (ktor's deepest real module is 3 levels: `ktor-server/ktor-server-plugins/
 *  ktor-server-auth`) without risking a pathological scan on a huge, unrelated tree. */
const MAX_BASENAME_INDEX_DEPTH = 8;

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
 * @param {string} stripped - `settings.gradle(.kts)` contents with comments already stripped.
 * @returns {string[]} Unique Gradle project paths without the leading colon (e.g. `core:data`).
 */
function parseIncludes(stripped: string): string[] {
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/['"](:[A-Za-z0-9_\-.:]+)['"]/g)) {
    const projectPath = (match[1] as string).replace(/^:/, "").replace(/:$/, "");
    if (projectPath) seen.add(projectPath);
  }
  return [...seen];
}

/**
 * @description Parses Kotlin's unary-plus project-declaration DSL (`+"module-name"`) some repos'
 *   custom settings plugins use instead of Gradle's standard `include(":module")` — confirmed on
 *   a real repo, ktorio/ktor: `projects { server { +"ktor-server-core"; nested("ktor-server-plugins")
 *   { +"ktor-server-auth" } ... } }`, with `including { }` blocks nesting sub-modules under their
 *   parent. This doesn't attempt to parse that block/nesting structure or compute each module's
 *   directory analytically — ktor's own module-name-to-directory resolution is done by its
 *   `build-settings-logic`/`ktorsettings` plugin at build time (observed: a block named `server`
 *   doesn't consistently prefix its modules' directories — `ktor-server-core` resolves to
 *   `ktor-server/ktor-server-core`, nested one level, while a module in the `shared` block,
 *   `ktor-http`, resolves to a bare top-level `ktor-http/` with no `shared/` prefix at all), so
 *   there's no fixed convention this detector could reproduce faithfully without a repo-specific
 *   special case. Instead this just extracts every declared bare module name; `detect()` resolves
 *   each to a real directory by basename search via {@link indexDirectoriesByBasename}.
 * @param {string} stripped - `settings.gradle(.kts)` contents with comments already stripped.
 * @returns {string[]} Unique bare module names, in source order.
 */
function parseUnaryPlusIncludes(stripped: string): string[] {
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/\+\s*['"]([A-Za-z0-9_-]+)['"]/g)) {
    const name = match[1];
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * @description Parses `includeBuild("path")` / `includeBuild('path')` composite-build targets
 *   out of a `settings.gradle(.kts)` file — Groovy and Kotlin-DSL forms are identical here, both
 *   calling a function with one string-literal path argument, optionally followed by a
 *   configuration lambda this doesn't need to parse. Composite-build targets are filesystem
 *   paths, not Gradle's colon-prefixed project-path syntax {@link parseIncludes} handles, so this
 *   is a separate scan. See `docs/known_issues/22-gradle-composite-build-not-detected.md`.
 * @param {string} stripped - `settings.gradle(.kts)` contents with comments already stripped.
 * @returns {string[]} Unique raw path strings exactly as written (not yet resolved to absolute
 *   paths — resolution is relative to the settings file's own directory, done by the caller).
 */
function parseIncludeBuilds(stripped: string): string[] {
  const seen = new Set<string>();
  for (const match of stripped.matchAll(/includeBuild\(\s*['"]([^'"]+)['"]/g)) {
    const target = match[1];
    if (target) seen.add(target);
  }
  return [...seen];
}

/**
 * @description Resolves every `includeBuild(...)` target to a `WorkspacePackage`, named by the
 *   target directory's basename (Gradle itself defaults to this when a composite build doesn't
 *   override its name via `name = "..."` in its own `settings.gradle` — not parsed here, a
 *   documented limitation). A target outside `rootDir` is skipped, not guessed at: a single-root
 *   detector has no way to walk a directory it isn't scanning, and representing it would need an
 *   explicit extra-root mechanism (`docs/known_issues/22-gradle-composite-build-not-detected.md`
 *   — planned, not yet built). This is the same "declared but not resolvable from what this scan
 *   can see" tolerance `parseUnaryPlusIncludes`'s caller already has for an unmatched module name.
 * @param {string} rootDir - Absolute analyzed root; targets outside it are skipped.
 * @param {string} settingsDir - Absolute directory containing the `settings.gradle(.kts)` file,
 *   the base `includeBuild` paths resolve against.
 * @param {string[]} targets - Raw path strings from {@link parseIncludeBuilds}.
 * @returns {WorkspacePackage[]} One package per in-root, source-bearing composite-build target.
 */
function resolveIncludeBuilds(
  rootDir: string,
  settingsDir: string,
  targets: string[],
): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const target of targets) {
    const absTarget = path.resolve(settingsDir, target);
    const rel = path.relative(rootDir, absTarget);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const pkg = buildJvmPackage(rootDir, absTarget, path.basename(absTarget));
    if (pkg) packages.push(pkg);
  }
  return packages;
}

/**
 * @description Whether `dir` has a `build.gradle(.kts)` directly inside it — the strongest
 *   available signal that a directory is a real Gradle module, versus an unrelated directory
 *   that merely happens to share a module's basename (e.g. a `core` module vs. some unrelated
 *   `test-fixtures/core`). Used only to break a basename collision in
 *   {@link indexDirectoriesByBasename}; a directory with real JVM sources but no build file is
 *   still accepted (ktor's own leaf modules commonly have no per-module build file, relying on
 *   the root/convention-plugin build instead), just ranked below one that has one.
 * @param {string} dir - Absolute directory path to check.
 * @returns {boolean} `true` if `build.gradle.kts` or `build.gradle` exists directly in `dir`.
 */
function hasGradleBuildFile(dir: string): boolean {
  return (
    fs.existsSync(path.join(dir, "build.gradle.kts")) ||
    fs.existsSync(path.join(dir, "build.gradle"))
  );
}

/**
 * @description Recursively indexes every directory under `rootDir` by basename, bounded to
 *   {@link MAX_BASENAME_INDEX_DEPTH} levels and skipping default-ignored directories (`build`,
 *   `.gradle`, `.git`, …) — the fallback resolution mechanism for
 *   {@link parseUnaryPlusIncludes}'s bare module names, which (unlike Gradle's native
 *   `include(":a:b")` colon-path syntax) carry no directory path of their own.
 * @param {string} rootDir - Absolute directory to index from.
 * @returns {Map<string, string[]>} Basename → every absolute directory path with that basename,
 *   ordered so the most likely real module is tried first on a name collision: a directory with
 *   its own `build.gradle(.kts)` wins over one without, then shortest path, then alphabetical.
 */
function indexDirectoriesByBasename(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();

  function walk(dir: string, depth: number): void {
    if (depth > MAX_BASENAME_INDEX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORE_DIR_SET.has(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const existing = index.get(entry.name);
      if (existing) existing.push(full);
      else index.set(entry.name, [full]);
      walk(full, depth + 1);
    }
  }

  walk(rootDir, 0);
  for (const paths of index.values()) {
    paths.sort((a, b) => {
      const buildFileRank = Number(hasGradleBuildFile(b)) - Number(hasGradleBuildFile(a));
      if (buildFileRank !== 0) return buildFileRank;
      return a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b);
    });
  }
  return index;
}

/**
 * @description Detects Gradle multi-module builds via `settings.gradle` / `settings.gradle.kts`.
 *   Each `include(":core:data")` becomes a `WorkspacePackage` rooted at `<root>/core/data`
 *   (Gradle's default project-path → directory mapping). Modules with a non-standard
 *   `projectDir` override are not relocated — a documented limitation (ADR-017).
 *
 *   Falls back to the unary-plus DSL (`parseUnaryPlusIncludes`) when no standard `include(...)`
 *   calls are found, resolving each bare module name to a directory by basename search rather
 *   than a computed path — best-effort, not exact, since that DSL's real resolution is
 *   plugin-specific (see `parseUnaryPlusIncludes`'s doc comment).
 *
 *   `includeBuild("path")` (composite builds) is parsed separately and merged into either form's
 *   result: an in-root target becomes an ordinary `WorkspacePackage` named by its directory
 *   basename; a target outside `rootDir` is skipped (see `resolveIncludeBuilds`'s doc comment and
 *   `docs/known_issues/22-gradle-composite-build-not-detected.md`).
 *
 *   Returns `null` (detector does not fire, repo builds as one flat graph) when no
 *   `settings.gradle*` exists or none of the three forms declares any resolvable modules — a
 *   single-module Gradle build is not a workspace.
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
    const stripped = stripComments(source);
    const settingsDir = path.dirname(settingsPath);

    // includeBuild(...) (composite builds) is additive to whichever of the two module-declaration
    // forms below fires — a repo can combine ordinary sub-modules with composite builds in the
    // same settings file — so it's resolved once up front and merged into either branch's result.
    const compositePackages = resolveIncludeBuilds(
      rootDir,
      settingsDir,
      parseIncludeBuilds(stripped),
    );

    const projectPaths = parseIncludes(stripped);
    if (projectPaths.length > 0) {
      const packages: WorkspacePackage[] = [...compositePackages];
      for (const projectPath of projectPaths) {
        const moduleRoot = path.join(rootDir, ...projectPath.split(":"));
        const pkg = buildJvmPackage(rootDir, moduleRoot, projectPath);
        if (pkg) packages.push(pkg);
      }
      return packages.length > 0 ? packages : null;
    }

    const unaryPlusNames = parseUnaryPlusIncludes(stripped);
    if (unaryPlusNames.length === 0) {
      return compositePackages.length > 0 ? compositePackages : null;
    }

    const byBasename = indexDirectoriesByBasename(rootDir);
    const packages: WorkspacePackage[] = [...compositePackages];
    for (const name of unaryPlusNames) {
      const moduleRoot = byBasename.get(name)?.[0];
      if (!moduleRoot) continue;
      const pkg = buildJvmPackage(rootDir, moduleRoot, name);
      if (pkg) packages.push(pkg);
    }
    return packages.length > 0 ? packages : null;
  },
};
