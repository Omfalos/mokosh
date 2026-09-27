/** Shared process-spawning helper for coverage runners. Uses `execFile` with an argv array (never
 *  a shell string) so no runner ever builds a shell command by interpolation — same discipline as
 *  `git.ts`'s `execFileSync` fix (see memory: real command-injection incident from `execSync` +
 *  interpolated filenames). */
import { execFile } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * @description Runs `cmd` with `args` in `cwd`, capturing stdout/stderr, and never throwing —
 *   a non-zero exit, a spawn failure (binary not on PATH), or a timeout all resolve to a result
 *   object instead of rejecting, so callers can treat "coverage tool errored" the same as
 *   "coverage tool not installed": this runner contributed nothing.
 * @param cmd - Executable name or path (no shell interpretation).
 * @param args - Argv, passed as an array — never concatenated into a shell string.
 * @param cwd - Working directory to run in.
 * @param timeoutMs - Kills the process and sets `timedOut: true` if it runs longer than this.
 * @returns {Promise<ExecResult>} Always resolves.
 */
export function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const signaled = Boolean(err && "signal" in err && err.signal);
        resolve({
          code: child.exitCode,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          // Node's `timeout` option kills the child with SIGTERM on expiry; a signal with no
          // exit code is the reliable "we killed it" signature (vs. a normal non-zero exit).
          timedOut: signaled && child.exitCode === null,
        });
      },
    );
  });
}
