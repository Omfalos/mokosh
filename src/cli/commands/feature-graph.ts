/** CLI command: groups files into feature domains under their hub orchestrators. */
import { buildFeatureGraph, createImportMap, getAllProjectFiles } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Groups files into feature domains under high-import hub files.
 *   Builds the full project graph first if the current graph is empty.
 *   Pass `--min-out-degree <N>` to override the default hub threshold.
 * @param {CommandContext} ctx - Shared command context.
 */
export async function run(ctx: CommandContext): Promise<void> {
  let { graph } = ctx;
  const { rootDir, scanOptions, minOutDegree, rawConfig } = ctx;

  if (graph.nodes.size === 0) {
    const allFiles = getAllProjectFiles(rootDir, scanOptions);
    graph = await createImportMap(rootDir, allFiles, graph, {
      pathAliases: rawConfig.pathAliases,
    });
  }

  const featureGraph = buildFeatureGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );
  const features = Object.fromEntries(featureGraph.features);
  console.log(JSON.stringify({ features, unassigned: featureGraph.unassigned }, null, 2));
}
