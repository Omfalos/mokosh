/** CLI command: lists every distinct tag in the graph with its per-node count. */
import type { CommandContext } from "./types";

/**
 * @description Counts how many nodes carry each distinct tag name across the graph and prints
 *   them sorted by count descending. Lets you check what tags exist before filtering with
 *   `--query "tag:<name>"` — mirrors the MCP `list_tags` tool. Includes all tag kinds, not just
 *   the subset kept by `--query`'s slim output.
 * @param {CommandContext} ctx - Shared command context carrying the built graph.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, plain } = ctx;

  const counts = new Map<string, number>();
  for (const node of graph.nodes.values()) {
    for (const tag of node.tags) {
      counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (plain) {
    console.log(tags.map((tag) => tag.name).join("\n"));
  } else {
    console.log(JSON.stringify({ tags, count: tags.length }, null, 2));
  }
}
