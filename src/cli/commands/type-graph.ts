/** CLI command: outputs the type-level import graph (interfaces, classes, enums, type aliases). */
import { buildTypeGraph, queryTypeGraph } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Builds and outputs the type graph derived from the import graph.
 *   When `--type <name>` is given, returns a focused view for that type (its usedByFiles and uses).
 *   Otherwise returns all type nodes and their count.
 * @param {CommandContext} ctx - Shared command context; `ctx.typeFilter` is the optional type name.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, typeFilter } = ctx;
  const typeGraph = buildTypeGraph(graph);

  if (typeFilter) {
    const result = queryTypeGraph(typeGraph, typeFilter);
    console.log(JSON.stringify(result, null, 2));
  } else {
    const types = Array.from(typeGraph.types.values());
    console.log(JSON.stringify({ count: types.length, types }, null, 2));
  }
}
