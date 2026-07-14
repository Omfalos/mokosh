/** CLI command: flags markdown docs whose referenced files changed more recently than the doc itself. */
import type { CommandContext } from "./types";

/**
 * @description Scans markdown nodes for `staleFor` entries (populated by `enrichDocDrift`) and
 *   prints each stale doc alongside the files that outpaced it. Exits with code 1 if any are
 *   found; otherwise confirms a clean state to stdout. This is a commit-recency heuristic, not
 *   a content diff — see `docs/adr-009-markdown-parsing.md` for the known limitations.
 *   Requires the graph to have been built with git stats enabled (`--git-stats` or config
 *   equivalent); otherwise every doc has no `lastCommitAt` data and nothing is flagged.
 * @param {CommandContext} ctx - Shared command context carrying the built graph.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph } = ctx;
  const staleDocs = [...graph.nodes.values()]
    .filter((node) => node.type === "markdown" && node.staleFor && node.staleFor.length > 0)
    .map((node) => ({ doc: node.path, staleFor: node.staleFor as string[] }));

  if (staleDocs.length > 0) {
    process.stderr.write(`Found ${staleDocs.length} doc(s) that may be out of date:\n`);
    for (const { doc, staleFor } of staleDocs) {
      process.stderr.write(`  ${doc} — references changed more recently: ${staleFor.join(", ")}\n`);
    }
    process.exit(1);
  }
  console.log("No doc drift detected.");
}
