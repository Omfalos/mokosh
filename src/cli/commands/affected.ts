/** CLI command: prints all files transitively affected if a given file changes, mirroring the MCP get_affected tool. */
import { buildChangeImpactCache, getAffected, getNodeMeta, queryChangeImpact } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Prints every file transitively affected if `--file` changes (full incoming
 *   traversal). Set `--tests-only` to restrict to test/spec files, `--changed-symbols` to
 *   restrict propagation to files that import those specific symbols, `--cached` to use
 *   a precomputed impact cache instead of a fresh traversal, and `--with-meta` to turn each
 *   affected path into `{ path, category, exports }`.
 * @param {CommandContext} ctx - Shared command context; `ctx.file` must be set via `--file`.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, file, testsOnly, changedSymbols, cached, withMeta } = ctx;

  if (!file) {
    console.error("Error: --affected requires --file <path>");
    process.exit(1);
  }

  const annotate = (paths: string[]) =>
    withMeta ? paths.map((p) => ({ path: p, ...getNodeMeta(graph, p) })) : paths;

  if (cached) {
    const impactCache = buildChangeImpactCache(graph);
    const allAffected = queryChangeImpact(impactCache, file);
    const affected = testsOnly
      ? allAffected.filter((filePath) => graph.nodes.get(filePath)?.category === "test")
      : allAffected;
    const result = annotate(affected);
    console.log(JSON.stringify({ file, affected: result, count: result.length }, null, 2));
    return;
  }

  const affected = getAffected(graph, file, { testsOnly, changedSymbols });
  const result = annotate(affected);
  console.log(JSON.stringify({ file, affected: result, count: result.length }, null, 2));
}
