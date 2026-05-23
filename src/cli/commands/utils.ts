import path from "node:path";
import { DefaultGitProvider } from "../../index";

const TEST_PATTERNS = [".test.", ".spec.", "-test.", "-spec."];

/**
 * @description Filters a file list to only those whose basename matches a known test-file
 *   naming pattern (.test., .spec., -test., -spec.).
 * @param allFiles - Full list of project file paths to filter.
 * @returns The subset of paths whose basename identifies them as test files.
 */
export function getTestFiles(allFiles: string[]): string[] {
  return allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return TEST_PATTERNS.some((p) => base.includes(p));
  });
}

/**
 * @description Fetches files from the current git diff and returns them as paths relative
 *   to rootDir, normalised to the same format used throughout the graph.
 * @param rootDir - Absolute path to the project root, used as the base for relative path computation.
 * @returns Paths of git-changed files relative to rootDir.
 */
export function resolveChangedFiles(rootDir: string): string[] {
  return new DefaultGitProvider().getChangedFiles().map((f) => path.relative(rootDir, path.resolve(rootDir, f)));
}
