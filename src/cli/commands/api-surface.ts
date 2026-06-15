/** CLI command: outputs the public API surface of the project. */
import { buildApiSurface, detectAllEntryPoints } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Builds the API surface report: all publicly exported symbols, with their
 *   definitions resolved through re-export chains. Entry points are taken from the CLI
 *   positional args; when none are given, they are auto-detected from package.json.
 *   Also partitions graph nodes into internalFiles, unreachableFromEntry, and testFiles.
 * @param {CommandContext} ctx - Shared command context; positional entry points come from the graph.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, rootDir, entryPoints } = ctx;
  const eps = entryPoints.length ? entryPoints : detectAllEntryPoints(graph, rootDir);

  if (eps.length === 0) {
    console.error(
      "Error: No entry points found. Pass entry points as positional args or ensure package.json has a main/exports field.",
    );
    process.exit(1);
  }

  const surface = buildApiSurface(graph, eps);
  console.log(JSON.stringify(surface, null, 2));
}
