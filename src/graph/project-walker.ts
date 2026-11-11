import fs from "node:fs";
import path from "node:path";
import { createNestedRepoLocator, shouldDescend } from "./discovery-filter.js";

/**
 * @description Synchronous project-tree traversal used by `GraphBuilder`'s discovery passes:
 *   which directories to descend into (ignore list, nested repos), which files match, and whether
 *   an import edge jumps into a nested repo. Holds no build state — pure filesystem policy.
 */
export class ProjectWalker {
  private readonly locateNestedRepo: (filePath: string) => string | null;

  /**
   * @param rootDir - Absolute project root.
   * @param ignoreDirs - Directory names never descended into.
   * @param includeNestedRepos - When true, directories with their own `.git` are walked.
   */
  constructor(
    private readonly rootDir: string,
    private readonly ignoreDirs: ReadonlySet<string>,
    private readonly includeNestedRepos: boolean,
  ) {
    this.locateNestedRepo = createNestedRepoLocator(rootDir);
  }

  /**
   * @description Whether a walk should recurse into a directory entry (not ignored, and not a
   *   nested repo unless opted in).
   * @param name - The directory entry's own name.
   * @param fullPath - Absolute path of the directory entry.
   * @returns True when the walk should descend.
   */
  shouldDescend(name: string, fullPath: string): boolean {
    return shouldDescend(name, fullPath, this.rootDir, this.ignoreDirs, this.includeNestedRepos);
  }

  /**
   * @description Whether resolving `from` -> `to` jumps into a nested repo that `from` is not
   *   itself part of. Imports within one nested repo are unaffected.
   * @param from - Absolute path of the importing file.
   * @param to - Absolute path of the resolved target file.
   * @returns True when the edge should be dropped.
   */
  crossesIntoNestedRepo(from: string, to: string): boolean {
    if (this.includeNestedRepos) return false;
    const targetRepo = this.locateNestedRepo(to);
    return targetRepo !== null && targetRepo !== this.locateNestedRepo(from);
  }

  /**
   * @description Recursively collects every file under `scanRoot` that satisfies `matches`, in
   *   directory-entry order. Unreadable directories are skipped.
   * @param scanRoot - Directory to walk.
   * @param matches - Predicate tested against each file entry.
   * @returns Absolute paths of the matching files.
   */
  collectFiles(scanRoot: string, matches: (entry: fs.Dirent) => boolean): string[] {
    const found: string[] = [];
    const visit = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (this.shouldDescend(entry.name, fullPath)) visit(fullPath);
        } else if (entry.isFile() && matches(entry)) {
          found.push(fullPath);
        }
      }
    };
    visit(scanRoot);
    return found;
  }

  /**
   * @description Cheaply checks whether `dir` contains at least `threshold` files, stopping as
   *   soon as the threshold is met rather than counting exhaustively.
   * @param dir - Directory to scan (recursively, skipping ignored directories and, by default, nested repos).
   * @param threshold - Minimum file count to confirm.
   * @returns Whether at least `threshold` files were found.
   */
  hasAtLeastFiles(dir: string, threshold: number): boolean {
    let count = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(current, entry.name);
          if (this.shouldDescend(entry.name, fullPath)) stack.push(fullPath);
        } else if (entry.isFile()) {
          count++;
          if (count >= threshold) return true;
        }
      }
    }
    return count >= threshold;
  }
}
