import { execSync } from "node:child_process";

/**
 * Interface for retrieving changed files from Git.
 * Allows for easier testing by mocking Git operations.
 */
export interface GitProvider {
  getChangedFiles(): string[];
}

/**
 * Default implementation of GitProvider that uses the Git CLI.
 */
export class DefaultGitProvider implements GitProvider {
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
 * Uses Git to find all modified, staged, and untracked files.
 * @deprecated Use DefaultGitProvider instead.
 */
export function getGitDiffFiles(): string[] {
  return new DefaultGitProvider().getChangedFiles();
}
