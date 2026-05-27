import type { CommandContext } from "./types";

/**
 * @description Prints files whose exported functions call into the given file.
 *   Uses call edges (function-level) rather than import edges, so the result is
 *   a subset of — and more precise than — what `get_affected` returns.
 * @param {CommandContext} ctx - Shared command context; `ctx.file` must be set via `--file`.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, file, plain } = ctx;

  if (!file) {
    console.error("Error: --callers requires --file <path>");
    process.exit(1);
  }

  const callers = graph.getCallers(file);

  if (plain) {
    console.log(callers.join("\n"));
  } else {
    console.log(JSON.stringify({ file, callers, count: callers.length }, null, 2));
  }
}
