/** CLI command: lists non-test files below the configured coverage threshold. */
import { hasCoverageData } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Lists non-test files whose line coverage is below the configured threshold.
 *   The threshold is resolved in priority order: `--feature-threshold` CLI flag →
 *   `coverageThreshold` in `mokosh.config.*` → 80.
 *   Coverage data must have been loaded during the graph build via `coverageReportPath` in config;
 *   if no coverage data was ever loaded, prints an error instead of misreporting every file as uncovered.
 * @param {CommandContext} ctx - Shared command context; `ctx.rawConfig.coverageThreshold` is the config-level default.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, featureThreshold, rawConfig, plain } = ctx;
  const threshold = featureThreshold ?? rawConfig.coverageThreshold ?? 80;

  if (!hasCoverageData(graph)) {
    console.log(
      JSON.stringify(
        {
          error:
            "No coverage data available. Set coverageReportPath in mokosh.config and rebuild the graph.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const uncovered = [...graph.nodes.values()]
    .filter((node) => node.category !== "test" && node.category !== "config")
    .filter((node) => node.coveragePct !== undefined && node.coveragePct < threshold)
    .map((node) => ({ file: node.path, coveragePct: node.coveragePct as number }));

  if (plain) {
    console.log(uncovered.map((uncoveredEntry) => uncoveredEntry.file).join("\n"));
  } else {
    console.log(JSON.stringify({ threshold, uncovered, count: uncovered.length }, null, 2));
  }
}
