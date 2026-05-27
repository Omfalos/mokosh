import { createImportMap, getAllProjectFiles, proposeTags } from "../../index";
import type { CommandContext } from "./types";
import { getTestFiles, resolveChangedFiles } from "./utils";

/**
 * @description Resolves git-changed files, builds a minimal test-file graph if the current
 *   graph is empty, then prints inferred test tags as JSON or space-separated plain text.
 * @param {CommandContext} ctx - Shared command context; `ctx.plain` switches output format to space-separated text.
 */
export async function run(ctx: CommandContext): Promise<void> {
  let { graph } = ctx;
  const { rootDir, scanOptions, featureThreshold, plain } = ctx;

  if (!plain) console.log("Proposing test tags based on git diff...");
  const changedFiles = resolveChangedFiles(rootDir);

  if (graph.nodes.size === 0) {
    const allFiles = getAllProjectFiles(rootDir, scanOptions);
    graph = await createImportMap(rootDir, getTestFiles(allFiles), graph);
  }

  const tags = proposeTags(graph, changedFiles, {
    ...(featureThreshold !== undefined && {
      featureDetection: { minOutDegree: featureThreshold },
    }),
  });

  if (plain) {
    console.log(tags.join(" "));
  } else {
    console.log(JSON.stringify({ proposedTags: tags }, null, 2));
  }
}
