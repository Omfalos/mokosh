/** Builds a FeatureGraph grouping graph nodes into feature domains under their respective hub files. */
import type { Graph } from "../model";
import type { FeatureDetectionOptions } from "./index";
import { detectFeatures } from "./index";

/**
 * A group of files that a single feature hub transitively imports.
 * The hub itself is the high-out-degree orchestrator; `files` are its dependencies.
 */
export interface FeatureDomain {
  /** Project-relative path of the feature hub file. */
  hub: string;
  /** Number of internal imports the hub has (its out-degree). */
  outDegree: number;
  /** All files transitively imported by the hub, excluding the hub itself. */
  files: string[];
}

/**
 * Domain-clustered view of the import graph.
 * Provides a token-efficient way to answer "what files are in domain X?"
 * without traversing the full graph.
 */
export interface FeatureGraph {
  /** Map from feature name (e.g. `"parser"`) to its domain info. */
  features: Map<string, FeatureDomain>;
  /**
   * Files not reachable from any feature hub — shared utilities, top-level
   * entry points, or files below the out-degree threshold.
   */
  unassigned: string[];
}

/**
 * Builds a domain-clustered view of the import graph by grouping files under
 * the most specific feature hub that can reach them.
 *
 * Assignment rule: each file is assigned to the hub with the lowest out-degree
 * that can transitively reach it. This favours specific, focused hubs
 * (e.g. `src/mcp/server.ts`) over broad aggregators (e.g. `src/index.ts`).
 *
 * @param graph - The import graph to cluster.
 * @param options - Controls which files qualify as feature hubs.
 * @returns A `FeatureGraph` with one domain per hub and an `unassigned` list.
 */
export function buildFeatureGraph(graph: Graph, options?: FeatureDetectionOptions): FeatureGraph {
  const hubs = detectFeatures(graph.nodes, options);

  // Pass 1: collect all files reachable from each hub (no exclusions yet).
  const reachable = new Map<string, Set<string>>();
  for (const hub of hubs.values()) {
    const files = new Set<string>();
    graph.traverse(
      hub.path,
      (node) => {
        if (node.path !== hub.path) files.add(node.path);
        return true;
      },
      { direction: "outgoing" },
    );
    reachable.set(hub.path, files);
  }

  // Pass 2: assign each non-hub file to the hub with the lowest out-degree
  // that can reach it (most specific hub wins).
  const fileToHub = new Map<string, string>();
  for (const [filePath] of graph.nodes) {
    if (hubs.has(filePath)) continue; // hubs belong to themselves, not to others
    let bestHubPath: string | null = null;
    let bestOutDegree = Infinity;
    for (const hub of hubs.values()) {
      if (reachable.get(hub.path)?.has(filePath) && hub.outDegree < bestOutDegree) {
        bestHubPath = hub.path;
        bestOutDegree = hub.outDegree;
      }
    }
    if (bestHubPath) fileToHub.set(filePath, bestHubPath);
  }

  // Pass 3: build FeatureDomain per hub.
  const features = new Map<string, FeatureDomain>();
  for (const hub of hubs.values()) {
    const featureName = hub.tag.replace("feature:", "");
    const files: string[] = [];
    for (const [filePath, ownerHub] of fileToHub) {
      if (ownerHub === hub.path) files.push(filePath);
    }
    features.set(featureName, { hub: hub.path, outDegree: hub.outDegree, files });
  }

  // Pass 4: collect unassigned files (not a hub and not claimed by any hub).
  const unassigned: string[] = [];
  for (const filePath of graph.nodes.keys()) {
    if (!hubs.has(filePath) && !fileToHub.has(filePath)) {
      unassigned.push(filePath);
    }
  }

  return { features, unassigned };
}
