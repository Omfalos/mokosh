/** Git integration: changed-file detection via GitProvider and repo-wide commit activity stats via getRepoGitStats. */
import { execFileSync } from "node:child_process";

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
        ["diff", "--name-only"],
        ["diff", "--cached", "--name-only"],
        ["ls-files", "--others", "--exclude-standard"],
      ];

      const allFiles = commands.flatMap((args) => {
        try {
          const output = execFileSync("git", args, {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          });
          return output
            .split("\n")
            .map((filePath) => filePath.trim())
            .filter((filePath) => filePath !== "");
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
  /** Unix timestamp (ms) of the most recent commit touching this file, regardless of the 90-day window. Used for doc-drift staleness comparisons. */
  lastCommitAt: number | undefined;
}

/** Null-byte-prefixed commit header emitted before each commit's file list, so header lines are unambiguous even when git's blank-line placement around `--name-status` output varies. */
const COMMIT_HEADER_FORMAT = "%x00%H%x09%ae%x09%at";

/** `--name-status` output can be sizeable for repos with long history; the default 1MB execFileSync buffer is too small. */
const MAX_LOG_BUFFER_BYTES = 256 * 1024 * 1024;

/**
 * @description Walks `git log --name-status` output (produced with {@link COMMIT_HEADER_FORMAT}) and
 *   invokes `onFile` for every (file, author, timestamp) touch point, newest commit first. Rename
 *   entries (`R<score>\t<old>\t<new>`) are attributed to the new path, approximating `--follow`
 *   semantics in aggregate across the whole repo rather than per file.
 * @param output - Raw stdout from a `git log --name-status --format=<COMMIT_HEADER_FORMAT>` invocation.
 * @param onFile - Called once per file touched by each commit, in newest-to-oldest order.
 */
function walkNameStatusLog(
  output: string,
  onFile: (filePath: string, authorEmail: string, timestampMs: number) => void,
): void {
  let authorEmail = "";
  let timestampMs = 0;

  for (const line of output.split("\n")) {
    if (line.startsWith("\u0000")) {
      const [, email, at] = line.slice(1).split("\t");
      authorEmail = email ?? "";
      timestampMs = at ? Number(at) * 1000 : 0;
      continue;
    }
    if (line === "") continue;

    const parts = line.split("\t");
    const status = parts[0];
    if (!status) continue;
    const filePath = status.startsWith("R") || status.startsWith("C") ? parts[2] : parts[1];
    if (!filePath) continue;

    onFile(filePath, authorEmail, timestampMs);
  }
}

/**
 * @description Computes commit activity stats for every file in the repository with two `git log`
 *   invocations total (independent of file count), instead of spawning per-file `git log` calls.
 *   The first, bounded call covers `commitCount90d`/`lastAuthor`/`lastCommitAt` for files touched in
 *   the last 90 days. The second, unbounded call only backfills `lastCommitAt` for files with no
 *   recent history, since that field is used unconditionally for doc-staleness comparisons.
 * @param rootDir - Absolute path to the repository root, passed to `git -C` so the command works from any cwd.
 * @returns Map keyed by repo-relative path, as reported by git (matching `FileNode.path`). Empty if
 *   `rootDir` isn't a git repository or git is unavailable.
 */
export function getRepoGitStats(rootDir: string): Map<string, GitFileStats> {
  const stats = new Map<string, GitFileStats>();

  try {
    const recentOutput = execFileSync(
      "git",
      [
        "-C",
        rootDir,
        "log",
        "--since=90 days ago",
        "--name-status",
        "-M",
        `--format=${COMMIT_HEADER_FORMAT}`,
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: MAX_LOG_BUFFER_BYTES },
    );

    walkNameStatusLog(recentOutput, (filePath, authorEmail, timestampMs) => {
      const existing = stats.get(filePath);
      if (existing) {
        existing.commitCount90d += 1;
        return;
      }
      stats.set(filePath, {
        commitCount90d: 1,
        lastAuthor: authorEmail || undefined,
        lastCommitAt: timestampMs || undefined,
      });
    });
  } catch {
    return stats;
  }

  try {
    const fullOutput = execFileSync(
      "git",
      ["-C", rootDir, "log", "--name-status", "-M", `--format=${COMMIT_HEADER_FORMAT}`],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: MAX_LOG_BUFFER_BYTES },
    );

    walkNameStatusLog(fullOutput, (filePath, _authorEmail, timestampMs) => {
      if (stats.has(filePath)) return;
      stats.set(filePath, {
        commitCount90d: 0,
        lastAuthor: undefined,
        lastCommitAt: timestampMs || undefined,
      });
    });
  } catch {
    // Full-history fallback unavailable — files with no commits in the last 90 days simply lack lastCommitAt.
  }

  return stats;
}
