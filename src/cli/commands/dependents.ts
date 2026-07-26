/** CLI command: prints files that directly import a given file (one-hop incoming), mirroring the MCP get_dependents tool. */
import { getDependents, getNodeMeta } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Prints files that directly import `--file`.
 * @param {CommandContext} ctx - Shared command context; `ctx.file` must be set via `--file`.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, file, withMeta } = ctx;

  if (!file) {
    console.error("Error: --dependents requires --file <path>");
    process.exit(1);
  }

  const deps = getDependents(graph, file);
  const dependents = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  console.log(JSON.stringify({ file, dependents }, null, 2));
}
