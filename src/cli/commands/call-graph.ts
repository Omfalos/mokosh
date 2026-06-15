/** CLI command: looks up callers and callees for a named function. */
import { queryCallGraph } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Returns the callers and callees of a named function using call edges.
 *   Only TypeScript/JavaScript files carry call edges.
 *   Requires `--function <name>`.
 * @param {CommandContext} ctx - Shared command context; `ctx.functionName` must be set.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, functionName } = ctx;

  if (!functionName) {
    console.error("Error: --call-graph requires --function <name>");
    process.exit(1);
  }

  const result = queryCallGraph(graph, functionName);
  console.log(JSON.stringify(result, null, 2));
}
