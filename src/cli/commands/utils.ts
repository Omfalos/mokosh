import path from "node:path";
import { getGitDiffFiles } from "../../index";

const TEST_PATTERNS = [".test.", ".spec.", "-test.", "-spec."];

/** Filters a file list to those whose basename matches a known test-file pattern. */
export function getTestFiles(allFiles: string[]): string[] {
  return allFiles.filter((f) => {
    const base = path.basename(f).toLowerCase();
    return TEST_PATTERNS.some((p) => base.includes(p));
  });
}

/** Returns git-diff files as paths relative to rootDir. */
export function resolveChangedFiles(rootDir: string): string[] {
  return getGitDiffFiles().map((f) => path.relative(rootDir, path.resolve(rootDir, f)));
}
