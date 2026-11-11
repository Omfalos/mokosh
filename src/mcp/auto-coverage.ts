import type { MokoshConfig } from "../config";
import { getOrRunCoverage } from "../graph/coverage/get-or-run";
import { applyStaticCoverage } from "../graph/coverage/static-estimate";
import { enrichCoverage } from "../graph/enrichment";
import type { Graph, MonorepoLayout } from "../index";

/**
 * @description Applies on-demand coverage (`coverage.mode: "static"` | `"exec"`) to `graph` in
 *   place. A no-op when the config has no `coverage.mode`. Shared by the single-package and
 *   workspace build paths; callers decide whether an explicit coverage report already applies.
 * @param root - Absolute project root.
 * @param graph - Graph to enrich (for a workspace, the flattened graph — nodes are shared).
 * @param layout - The root's monorepo layout, used to pick per-package scan roots.
 * @param coverage - The config's `coverage` block.
 */
export async function applyOnDemandCoverage(
  root: string,
  graph: Graph,
  layout: MonorepoLayout,
  coverage: MokoshConfig["coverage"],
): Promise<void> {
  if (coverage?.mode === "static") {
    applyStaticCoverage(graph);
    return;
  }
  if (coverage?.mode !== "exec") return;
  const autoMap = await getOrRunCoverage(root, graph.nodes.values(), layout, {
    timeoutMs: coverage.timeoutMs,
    packages: coverage.packages,
  });
  if (autoMap.size > 0) enrichCoverage(graph.nodes, autoMap);
}
