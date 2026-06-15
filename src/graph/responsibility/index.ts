/** Builds a ResponsibilityGraph assigning each file a semantic role based on its connectivity and feature membership. */
import { buildFeatureGraph } from "../features/feature-graph";
import type { FeatureDetectionOptions } from "../features/index";
import type { Graph } from "../model";
import { inferRole } from "./infer-role";
import type { ResponsibilityGraph } from "./types";

export type { ModuleResponsibility, ModuleRole, ResponsibilityGraph } from "./types";

/**
 * Builds a responsibility map for every file in the graph.
 *
 * Each entry is derived entirely from data already present in the `FileNode`:
 * - `description` comes from the file's leading JSDoc (`FileNode.description`)
 * - `exports` are the exported symbol names
 * - `role` is inferred from file path and category via `inferRole`
 * - `featureHub` is resolved via `buildFeatureGraph` with default options
 *
 * Test files are included with `role: "test"` so callers can filter them if needed.
 *
 * @param {Graph} graph - The import graph to derive responsibilities from.
 * @param {FeatureDetectionOptions} [featureOptions] - Options forwarded to `buildFeatureGraph` (e.g. `minOutDegree`).
 * @returns {ResponsibilityGraph} A map from each file path to its `ModuleResponsibility`.
 */
export function buildResponsibilityGraph(
  graph: Graph,
  featureOptions?: FeatureDetectionOptions,
): ResponsibilityGraph {
  const featureGraph = buildFeatureGraph(graph, featureOptions);

  // Build a reverse map: file path → feature hub name.
  const fileToHub = new Map<string, string>();
  for (const [featureName, domain] of featureGraph.features) {
    for (const filePath of domain.files) {
      fileToHub.set(filePath, featureName);
    }
    // The hub itself belongs to its own feature.
    fileToHub.set(domain.hub, featureName);
  }

  const result: ResponsibilityGraph = new Map();
  for (const node of graph.nodes.values()) {
    const hub = fileToHub.get(node.path);
    result.set(node.path, {
      path: node.path,
      role: inferRole(node),
      ...(node.description ? { description: node.description } : {}),
      exports: node.exports.map((e) => e.name),
      ...(hub ? { featureHub: hub } : {}),
    });
  }

  return result;
}
