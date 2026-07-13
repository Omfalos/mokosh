/** CLI command: lists functions/methods at or above a complexity threshold, mirroring the MCP find_complex_functions tool. */
import { findComplexFunctions } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Scans every file's per-function complexity breakdown and prints functions/methods
 *   at or above `--complexity-threshold`, sorted worst-first. TypeScript/JavaScript only.
 * @param {CommandContext} ctx - Shared command context; `ctx.metric`, `ctx.complexityThreshold`, and `ctx.limit` tune the scan.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, metric, complexityThreshold, limit } = ctx;
  const threshold = complexityThreshold ?? 10;
  const functions = findComplexFunctions(graph, { metric, threshold, limit });
  console.log(
    JSON.stringify(
      { metric: metric ?? "cognitiveComplexity", threshold, functions, count: functions.length },
      null,
      2,
    ),
  );
}
