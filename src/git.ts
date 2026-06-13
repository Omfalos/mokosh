/** Git integration: changed-file detection via GitProvider and per-file commit activity stats via getGitFileStats. */
import { execSync } from "node:child_process";

/**
 * @description Contract for querying changed files from a version-control backend.
 *   Abstracted so the CLI and MCP server can be tested without a live git repository.
 */
export interface GitProvider {
  getChangedFiles(): string[];
}

/**
 * @description Default `GitProvider` that shells out to the git CLI to discover
 *   modified, staged, and untracked files in the current repository.
 */
export class DefaultGitProvider implements GitProvider {
  /**
   * @description Returns a deduplicated list of all modified, staged, and untracked files by running three git commands.
   *   Returns an empty array if not inside a git repository or if git is unavailable.
   * @returns Relative file paths as reported by git, deduplicated across all three query types.
   */
  public getChangedFiles(): string[] {
    try {
      const commands = [
        "git diff --name-only",
        "git diff --cached --name-only",
        "git ls-files --others --exclude-standard",
      ];

      const allFiles = commands.flatMap((cmd) => {
        try {
          const output = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
          return output
            .split("\n")
            .map((f) => f.trim())
            .filter((f) => f !== "");
        } catch {
          return [];
        }
      });

      return Array.from(new Set(allFiles));
    } catch (error) {
      console.error("Error getting git diff:", error);
      return [];
    }
  }
}

/**
 * @description Commit activity metadata for a single file, used to surface churn and ownership signals.
 */
export interface GitFileStats {
  commitCount90d: number;
  lastAuthor: string | undefined;
}

/**
 * @description Queries git log to compute commit frequency and last author for a file over the past 90 days.
 * @param rootDir - Absolute path to the repository root, passed to `git -C` so the command works from any cwd.
 * @param relativePath - Path to the file relative to `rootDir`.
 * @returns Commit count and the email of the most recent author, or `undefined` if the file has no history.
 */
export function getGitFileStats(rootDir: string, relativePath: string): GitFileStats {
  const output = execSync(
    `git -C "${rootDir}" log --follow --format="%ae" --since="90 days ago" -- "${relativePath}"`,
    { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const lines = output.split("\n").filter(Boolean);
  return { commitCount90d: lines.length, lastAuthor: lines[0] };
}
