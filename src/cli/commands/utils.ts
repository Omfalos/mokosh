/** Shared CLI command utilities: test-file filtering and git-diff resolution. */
import path from "node:path";
import { DefaultGitProvider } from "../../git";

const TEST_PATTERNS = [".test.", ".spec.", "-test.", "-spec."];

/**
 * @description Filters a file list to only those whose basename matches a known test-file
 *   naming pattern (.test., .spec., -test., -spec.).
 * @param {string[]} allFiles - Full list of project file paths to filter.
 * @returns {string[]} The subset of paths whose basename identifies them as test files.
 */
export function getTestFiles(allFiles: string[]): string[] {
  return allFiles.filter((filePath) => {
    const base = path.basename(filePath).toLowerCase();
    return TEST_PATTERNS.some((pattern) => base.includes(pattern));
  });
}

/**
 * @description Fetches files from the current git diff and returns them as paths relative
 *   to rootDir, normalised to the same format used throughout the graph.
 * @param {string} rootDir - Absolute path to the project root, used as the base for relative path computation.
 * @returns {string[]} Paths of git-changed files relative to rootDir.
 */
export function resolveChangedFiles(rootDir: string): string[] {
  return new DefaultGitProvider()
    .getChangedFiles()
    .map((filePath) => path.relative(rootDir, path.resolve(rootDir, filePath)));
}
