/** CLI command: writes @tag annotations into test files based on the dependency graph. */
import { applyTags, configToGraphOptions, createImportMap, getAllProjectFiles } from "../../index";
import type { CommandContext } from "./types";
import { getTestFiles } from "./utils";

/**
 * @description Lazily enriches the graph with test nodes if needed, then writes `@tag`
 *   annotations into each test file using only `import` and `comment-marker` kind tags.
 *   In dry-run mode prints what would change without writing to disk.
 * @param {CommandContext} ctx - Shared command context; `ctx.dryRun` controls write behaviour.
 * @returns {Promise<void>} Resolves when all files have been processed and results printed.
 */
export async function run(ctx: CommandContext): Promise<void> {
  let { graph } = ctx;
  const { rootDir, scanOptions, dryRun, plain, rawConfig } = ctx;

  if (!plain) {
    console.log(dryRun ? "Dry run: computing tag changes..." : "Applying tags to test files...");
  }

  if (graph.nodes.size === 0) {
    const allFiles = getAllProjectFiles(rootDir, scanOptions);
    graph = await createImportMap(
      rootDir,
      getTestFiles(allFiles),
      graph,
      configToGraphOptions(rawConfig),
    );
  }

  const result = await applyTags(graph, rootDir, { dryRun });
  console.log(JSON.stringify(result, null, 2));
}
