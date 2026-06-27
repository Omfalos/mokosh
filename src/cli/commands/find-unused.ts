/** CLI command: lists files unreachable from the entry points (candidates for deletion). */
import path from "node:path";
import { getAllProjectFiles } from "../../index";
import type { CommandContext } from "./types";

const TEST_PATH_PATTERNS = [".test.", ".spec.", "-test.", "-spec.", ".stories."];

/**
 * @description Returns true when the file's basename matches a known test or story filename
 *   pattern, used to optionally exclude test files from the unused-files report.
 * @param {string} filePath - File path whose basename is tested against known test/story patterns.
 * @returns {boolean} True if the basename matches a test or story naming convention.
 */
function isTestPath(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return TEST_PATH_PATTERNS.some((pattern) => base.includes(pattern));
}

/**
 * @description Finds all project files that have no incoming imports, optionally excluding
 *   test and story files, then prints the list as a JSON object.
 * @param {CommandContext} ctx - Shared command context; `ctx.excludeTests` controls test-file filtering.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, rootDir, scanOptions, excludeTests } = ctx;
  const allProjectFiles = getAllProjectFiles(rootDir, scanOptions);
  let unusedFiles = graph.findUnusedFiles(allProjectFiles);

  if (excludeTests) {
    unusedFiles = unusedFiles.filter((filePath) => !isTestPath(filePath));
  }

  console.log(JSON.stringify({ unusedFiles }, null, 2));
}
