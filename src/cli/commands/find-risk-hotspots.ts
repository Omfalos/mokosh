/** CLI command: lists functions that are complex, undertested, and (if git stats are loaded) frequently changed. */
import { findRiskHotspots, hasCoverageData } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Finds functions that are complex, in a poorly-covered file, and — when git churn
 *   data is loaded — in a frequently-changed file. Coverage data must have been loaded during the
 *   graph build via `coverageReportPath` in config; if no coverage data was ever loaded, prints an
 *   error instead of misreporting every function as a hotspot. Churn (`gitStats: true` in config)
 *   is optional — when absent, the churn filter is skipped and `churnDataAvailable: false` is
 *   reported, since complexity + low coverage alone is still a meaningful signal.
 * @param {CommandContext} ctx - Shared command context; `ctx.metric`/`ctx.complexityThreshold` tune
 *   the complexity filter, `ctx.maxCoveragePct`/`ctx.minChurn` tune the coverage/churn filters, and
 *   `ctx.limit` caps the results.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, metric, complexityThreshold, maxCoveragePct, minChurn, limit } = ctx;

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

  const minComplexity = complexityThreshold ?? 10;
  const maxCoverage = maxCoveragePct ?? 50;
  const minChurnCount = minChurn ?? 0;
  const { hotspots, count, churnDataAvailable } = findRiskHotspots(graph, {
    metric,
    minComplexity,
    maxCoveragePct: maxCoverage,
    minChurn: minChurnCount,
    limit,
  });
  console.log(
    JSON.stringify(
      {
        metric: metric ?? "cognitiveComplexity",
        minComplexity,
        maxCoveragePct: maxCoverage,
        minChurn: minChurnCount,
        churnDataAvailable,
        hotspots,
        count,
      },
      null,
      2,
    ),
  );
}
