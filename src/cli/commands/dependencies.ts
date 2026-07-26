/** CLI command: prints files that a given file imports (outgoing traversal), mirroring the MCP get_dependencies tool. */
import { getDependencies, getNodeMeta } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Prints files reachable from `--file` via outgoing import edges, up to `--depth` hops.
 * @param {CommandContext} ctx - Shared command context; `ctx.file` must be set via `--file`.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, file, depth, withMeta } = ctx;

  if (!file) {
    console.error("Error: --dependencies requires --file <path>");
    process.exit(1);
  }

  const deps = getDependencies(graph, file, depth ?? 1);
  const dependencies = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  console.log(JSON.stringify({ file, dependencies }, null, 2));
}
