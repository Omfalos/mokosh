/** CLI command: outputs each file's semantic role, description, and exported symbols. */
import { buildResponsibilityGraph } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Builds a responsibility graph and outputs what each module is responsible for.
 *   Pass `--paths a,b` to filter to specific files; omit to get all modules.
 *   Pass `--min-out-degree <N>` to tune hub detection threshold.
 * @param {CommandContext} ctx - Shared command context.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, filterPaths, minOutDegree } = ctx;
  const respGraph = buildResponsibilityGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );

  if (filterPaths?.length) {
    const modules = filterPaths.map((p) => respGraph.get(p)).filter(Boolean);
    console.log(JSON.stringify({ count: modules.length, modules }, null, 2));
  } else {
    const modules = Array.from(respGraph.values());
    console.log(JSON.stringify({ count: modules.length, modules }, null, 2));
  }
}
