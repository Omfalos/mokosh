/** CLI command: compares the current graph (HEAD/working tree) against a base ref — file diff, stale post-rename references, and duplication/complexity/doc-drift/coverage deltas. Mirrors the MCP compare_branches tool. */
import { compareBranches, configToGraphOptions } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Builds the graph at `--compare-branches <baseRef>` (via a temporary git worktree,
 *   cached to disk by commit sha — see `src/graph/branch-graph-cache.ts`) and diffs it against
 *   the already-built head graph. Answers PR-review questions like "did this change introduce
 *   duplication?" and "did every call site of a renamed export get updated?".
 * @param {CommandContext} ctx - Shared command context; `ctx.compareBranches` is the base ref,
 *   `ctx.minDuplicateLines`/`ctx.metric`/`ctx.complexityThreshold`/`ctx.maxCoveragePct` tune the
 *   underlying tool calls.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, rootDir, compareBranches: baseRef, rawConfig } = ctx;

  if (!baseRef) {
    console.error("Error: --compare-branches requires a base ref, e.g. --compare-branches main");
    process.exit(1);
  }

  const comparison = await compareBranches(rootDir, baseRef, graph, {
    entryPoints: ctx.entryPoints,
    minDuplicateLines: ctx.minDuplicateLines,
    complexityMetric: ctx.metric,
    complexityThreshold: ctx.complexityThreshold,
    maxCoveragePct: ctx.maxCoveragePct,
    ...configToGraphOptions(rawConfig),
  });

  console.log(JSON.stringify(comparison, null, 2));
}
