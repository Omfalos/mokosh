/** CLI command: lists non-test files below the configured coverage threshold. */
import type { CommandContext } from "./types";

/**
 * @description Lists non-test files whose line coverage is below the configured threshold.
 *   The threshold is resolved in priority order: `--feature-threshold` CLI flag →
 *   `coverageThreshold` in `mokosh.config.*` → 80.
 *   Coverage data must have been loaded during the graph build via `coverageReportPath` in config.
 * @param {CommandContext} ctx - Shared command context; `ctx.rawConfig.coverageThreshold` is the config-level default.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, featureThreshold, rawConfig, plain } = ctx;
  const threshold = featureThreshold ?? rawConfig.coverageThreshold ?? 80;

  const uncovered = [...graph.nodes.values()]
    .filter((node) => node.category !== "test" && node.category !== "config")
    .filter((node) => (node.coveragePct ?? 0) < threshold)
    .map((node) => ({ file: node.path, coveragePct: node.coveragePct ?? null }));

  if (plain) {
    console.log(uncovered.map((uncoveredEntry) => uncoveredEntry.file).join("\n"));
  } else {
    console.log(JSON.stringify({ threshold, uncovered, count: uncovered.length }, null, 2));
  }
}
