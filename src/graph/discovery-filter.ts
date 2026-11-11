/** Shared directory-filtering rules for every file-discovery walk: the ignore-dir list plus nested-repo (git worktree / submodule / vendored clone) detection. */
import fs from "node:fs";
import path from "node:path";

/**
 * @description Whether `dir` is the root of a nested git repository: a directory below `rootDir`
 *   that contains a `.git` entry (a file for worktrees and submodules, a directory for full
 *   clones). The project root itself is never a nested repo, even though it usually has its own
 *   `.git`.
 * @param {string} dir - Absolute path of the directory to test.
 * @param {string} rootDir - Absolute path of the project root.
 * @returns {boolean} True when `dir` is a nested repository root.
 */
export function isNestedRepo(dir: string, rootDir: string): boolean {
  if (path.resolve(dir) === path.resolve(rootDir)) return false;
  return fs.existsSync(path.join(dir, ".git"));
}

/**
 * @description Decides whether a directory walk should recurse into a directory entry: not on the
 *   ignore list and, unless nested repos are opted in, not the root of a nested repository.
 * @param {string} name - The directory entry's own name (matched against `ignoreDirs`).
 * @param {string} fullPath - Absolute path of the directory entry.
 * @param {string} rootDir - Absolute path of the project root.
 * @param {ReadonlySet<string>} ignoreDirs - Directory names to skip.
 * @param {boolean} includeNestedRepos - When true, nested repositories are walked like any other directory.
 * @returns {boolean} True when the walk should descend into the directory.
 */
export function shouldDescend(
  name: string,
  fullPath: string,
  rootDir: string,
  ignoreDirs: ReadonlySet<string>,
  includeNestedRepos: boolean,
): boolean {
  if (ignoreDirs.has(name)) return false;
  return includeNestedRepos || !isNestedRepo(fullPath, rootDir);
}

/**
 * @description Creates a cached lookup that maps a file to the nearest enclosing nested-repo root
 *   below `rootDir` (or `null` when the file is not inside one). Results are cached per
 *   directory, so the cost is one `existsSync` per distinct directory, not per file. Paths
 *   outside `rootDir` (e.g. workspace external roots) are never inside a nested repo.
 * @param {string} rootDir - Absolute path of the project root.
 * @returns {(filePath: string) => string | null} Lookup returning the nested-repo root directory, or `null`.
 */
export function createNestedRepoLocator(rootDir: string): (filePath: string) => string | null {
  const root = path.resolve(rootDir);
  const cache = new Map<string, string | null>();

  /**
   * @description Walks up from `dir` toward the project root, caching every directory visited.
   * @param {string} dir - Absolute directory to start from.
   * @returns {string | null} Nearest enclosing nested-repo root, or `null`.
   */
  const locate = (dir: string): string | null => {
    if (dir === root || !dir.startsWith(root + path.sep)) return null;
    const cached = cache.get(dir);
    if (cached !== undefined) return cached;
    const found = fs.existsSync(path.join(dir, ".git")) ? dir : locate(path.dirname(dir));
    cache.set(dir, found);
    return found;
  };

  return (filePath) => locate(path.dirname(path.resolve(filePath)));
}
