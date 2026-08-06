/** CLI command: lists duplicated code blocks across the project, mirroring the MCP find_duplicates tool. */
import { DEFAULT_IGNORE_DIRS, findDuplicates } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Scans every file in the graph for cross-file (and within-file) duplicated code
 *   and prints the resulting blocks, largest-first. Works for every language mokosh parses —
 *   the underlying detector is token-based, not AST-based, so it doesn't depend on per-language
 *   parser support. Lock files and files under an ignored directory (project config's
 *   `ignoreDirs`, merged with the defaults) are excluded even when the graph itself contains
 *   them — `graph.nodes` isn't ignore-rule-filtered for files reached via a resolved reference
 *   rather than the initial FS walk.
 * @param {CommandContext} ctx - Shared command context; `ctx.rootDir`, `ctx.scanOptions`,
 *   `ctx.minDuplicateLines`, and `ctx.limit` tune the scan.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, rootDir, scanOptions, minDuplicateLines, limit } = ctx;
  const minLines = minDuplicateLines ?? 6;
  const ignoreDirs = [
    ...(scanOptions.ignoreDirs ?? DEFAULT_IGNORE_DIRS),
    ...(scanOptions.additionalIgnoreDirs ?? []),
  ];
  const groups = await findDuplicates(graph, rootDir, { minLines, limit, ignoreDirs });
  console.log(JSON.stringify({ minLines, groups, count: groups.length }, null, 2));
}
