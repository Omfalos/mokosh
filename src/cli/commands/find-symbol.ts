/** CLI command: finds every file that exports a symbol by name. */
import { findSymbol } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Finds every file that exports `functionName` (reused as the symbol name),
 *   with the best available usage info per match — call-edge callers for TS/JS, named-import
 *   tracking for Python, whole-file dependents otherwise.
 * @param {CommandContext} ctx - Shared command context; `ctx.functionName` must be set via `--function`.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, functionName, plain } = ctx;

  if (!functionName) {
    console.error("Error: --find-symbol requires --function <name>");
    process.exit(1);
  }

  const matches = findSymbol(graph, functionName);

  if (plain) {
    console.log(matches.map((match) => match.path).join("\n"));
  } else {
    console.log(JSON.stringify({ name: functionName, matches, count: matches.length }, null, 2));
  }
}
