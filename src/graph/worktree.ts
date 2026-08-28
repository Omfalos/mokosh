/** Materializes an arbitrary git ref into a temporary checkout via `git worktree`, for building a Graph at a commit other than the current working tree. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * @description Resolves a git ref (branch, tag, sha, `HEAD`, …) to its full commit sha.
 * @param rootDir - Absolute path to the repository (or worktree) root; the command runs with this as `cwd`.
 * @param ref - Any ref `git rev-parse` accepts.
 * @returns The full 40-character commit sha.
 * @throws {Error} If `ref` does not resolve (unknown ref, or not a git repository).
 */
export function resolveRef(rootDir: string, ref: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(`Could not resolve git ref "${ref}" in ${rootDir}`);
  }
}

/**
 * @description Checks out `sha` into a temporary `git worktree`, runs `fn` against that
 *   directory, then always removes the worktree — even if `fn` throws. Uses `--detach` so the
 *   temporary checkout never claims a branch name (avoids "branch already checked out"
 *   conflicts with the caller's own working tree).
 * @param rootDir - Absolute path to the repository root the worktree is added from.
 * @param sha - Commit sha to check out (resolve with {@link resolveRef} first for a stable cache key).
 * @param fn - Callback given the absolute path of the temporary worktree directory.
 * @returns Whatever `fn` returns.
 */
export async function withWorktree<T>(
  rootDir: string,
  sha: string,
  fn: (worktreeDir: string) => Promise<T>,
): Promise<T> {
  const worktreeDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `mokosh-worktree-${sha.slice(0, 12)}-`),
  );
  // mkdtemp already created the directory; `git worktree add` refuses a non-empty existing
  // directory, but happily reuses an empty one, so remove it first and let git recreate it.
  fs.rmdirSync(worktreeDir);

  try {
    execFileSync("git", ["worktree", "add", "--detach", worktreeDir, sha], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return await fn(worktreeDir);
  } finally {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // Best-effort: if git couldn't remove it (e.g. already gone), fall back to a plain rm so
      // no orphaned temp directories accumulate; a leftover `.git/worktrees` admin entry is
      // harmless and `git worktree prune` cleans it up.
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    }
  }
}
