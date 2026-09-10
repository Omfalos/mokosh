/** CLI command: bounded tag inventory for the graph, mirroring the MCP `list_tags` tool. */
import { buildTagInventory, summarizeTagInventory } from "../../index";
import type { TagKind } from "../../types/parse";
import type { CommandContext } from "./types";

/**
 * @description Prints a bounded tag inventory (always ≤ 250 tags). By default shows only the
 *   query-meaningful kinds (`comment-marker`, `import`) with count ≥ 2, sorted by count
 *   descending, top 100, plus a `byKind` histogram and `totalDistinct`. `--tag-kind`,
 *   `--tag-prefix`, `--tag-min-count` and `--tag-limit` narrow the list; `--plain` prints the
 *   resulting names one per line. Mirrors the MCP `list_tags` tool.
 * @param {CommandContext} ctx - Shared command context carrying the built graph.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, plain, tagKind, tagPrefix, tagMinCount, tagLimit } = ctx;

  const summary = summarizeTagInventory(buildTagInventory([graph]), {
    kind: tagKind as TagKind | "all" | undefined,
    prefix: tagPrefix,
    minCount: tagMinCount,
    limit: tagLimit,
  });

  if (plain) {
    console.log(summary.tags.map((tag) => tag.name).join("\n"));
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}
