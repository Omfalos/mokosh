import { createImportMap, getAllProjectFiles, proposeAffectedTests } from "../../index";
import type { CommandContext } from "./types";
import { getTestFiles, resolveChangedFiles } from "./utils";

/**
 * @description Resolves git-changed files, lazily enriches the dependency graph with test
 *   nodes if none are present, then prints every test file affected by those changes to stdout.
 * @param {CommandContext} ctx - Shared command context; `ctx.featureThreshold` tunes feature-hub detection.
 */
export async function run(ctx: CommandContext): Promise<void> {
  let { graph } = ctx;
  const { rootDir, scanOptions, featureThreshold } = ctx;

  const changedFiles = resolveChangedFiles(rootDir);

  const hasTestNodes = [...graph.nodes.values()].some((n) => getTestFiles([n.path]).length > 0);
  if (!hasTestNodes) {
    const allFiles = getAllProjectFiles(rootDir, scanOptions);
    graph = await createImportMap(rootDir, getTestFiles(allFiles), graph);
  }

  const affectedTests = proposeAffectedTests(graph, changedFiles, {
    ...(featureThreshold !== undefined && {
      featureDetection: { minOutDegree: featureThreshold },
    }),
  });
  console.log(affectedTests.join("\n"));
}
