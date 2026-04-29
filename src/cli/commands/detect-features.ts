import { createImportMap, detectFeatures, getAllProjectFiles } from "../../index";
import type { CommandContext } from "./types";

export async function run(ctx: CommandContext): Promise<void> {
  let { graph } = ctx;
  const { rootDir, scanOptions, featureThreshold } = ctx;

  if (graph.nodes.size === 0) {
    const allFiles = getAllProjectFiles(rootDir, scanOptions);
    graph = await createImportMap(rootDir, allFiles, graph);
  }

  const featureMap = detectFeatures(
    graph.nodes,
    featureThreshold !== undefined ? { minOutDegree: featureThreshold } : undefined,
  );
  const features = Array.from(featureMap.values()).sort((a, b) => b.outDegree - a.outDegree);
  console.log(JSON.stringify({ features }, null, 2));
}
