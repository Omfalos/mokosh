/** Builds a FeatureGraph grouping graph nodes into feature domains under their respective hub files. */
import type { FileNode } from "../../types/node";
import type { Graph } from "../model";
import { detectFeatures, type FeatureDetectionOptions, type FeatureInfo } from "./index";

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
 * Options for `buildFeatureGraph`. Extends `FeatureDetectionOptions` so callers
 * can pass `{ minOutDegree }` without needing to know this type explicitly.
 */
export interface FeatureGraphOptions extends FeatureDetectionOptions {
  /**
   * Comparator used to pick the "best" hub when a file is reachable from
   * multiple hubs. Return a negative number when `left` should win over `right`.
   * @default ascending out-degree (most-specific hub wins)
   */
  hubComparator?: (left: FeatureInfo, right: FeatureInfo) => number;
  /**
   * Override the hub-detection function. Defaults to `detectFeatures`.
   * Inject a custom implementation for testing or alternative hub strategies.
   */
  detectFn?: (
    nodes: Map<string, FileNode>,
    options?: FeatureDetectionOptions,
  ) => Map<string, FeatureInfo>;
}

const DEFAULT_HUB_COMPARATOR = (left: FeatureInfo, right: FeatureInfo) =>
  left.outDegree - right.outDegree;

/**
 * @param graph - The import graph to cluster.
 * @param hubs - Detected feature hub files.
 * @returns Map from hub path to the set of files reachable from that hub (hub itself excluded).
 */
function collectReachable(graph: Graph, hubs: Map<string, FeatureInfo>): Map<string, Set<string>> {
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
  return reachable;
}

/**
 * @param nodes - All graph nodes.
 * @param hubs - Detected feature hub files.
 * @param reachable - Pre-computed reachability sets from `collectReachable`.
 * @param comparator - Tiebreak function; lower return value means the hub wins.
 * @returns Map from non-hub file path to the path of its assigned hub.
 */
function assignFilesToHubs(
  nodes: Map<string, FileNode>,
  hubs: Map<string, FeatureInfo>,
  reachable: Map<string, Set<string>>,
  comparator: (left: FeatureInfo, right: FeatureInfo) => number,
): Map<string, string> {
  const fileToHub = new Map<string, string>();
  for (const [filePath] of nodes) {
    if (hubs.has(filePath)) continue;
    let bestHub: FeatureInfo | null = null;
    for (const hub of hubs.values()) {
      if (!reachable.get(hub.path)?.has(filePath)) continue;
      if (!bestHub || comparator(hub, bestHub) < 0) bestHub = hub;
    }
    if (bestHub) fileToHub.set(filePath, bestHub.path);
  }
  return fileToHub;
}

/**
 * @param hubs - Detected feature hub files.
 * @param fileToHub - Assignment map from `assignFilesToHubs`.
 * @returns Map from feature name to its `FeatureDomain`.
 */
function buildDomains(
  hubs: Map<string, FeatureInfo>,
  fileToHub: Map<string, string>,
): Map<string, FeatureDomain> {
  const features = new Map<string, FeatureDomain>();
  for (const hub of hubs.values()) {
    const featureName = hub.tag.replace("feature:", "");
    const files: string[] = [];
    for (const [filePath, ownerHub] of fileToHub) {
      if (ownerHub === hub.path) files.push(filePath);
    }
    features.set(featureName, { hub: hub.path, outDegree: hub.outDegree, files });
  }
  return features;
}

/**
 * @param nodes - All graph nodes.
 * @param hubs - Detected feature hub files.
 * @param fileToHub - Assignment map from `assignFilesToHubs`.
 * @returns File paths that are neither a hub nor claimed by any hub.
 */
function collectUnassigned(
  nodes: Map<string, FileNode>,
  hubs: Map<string, FeatureInfo>,
  fileToHub: Map<string, string>,
): string[] {
  const unassigned: string[] = [];
  for (const filePath of nodes.keys()) {
    if (!hubs.has(filePath) && !fileToHub.has(filePath)) {
      unassigned.push(filePath);
    }
  }
  return unassigned;
}

/** Default cap on features listed by the MCP `get_feature_graph` summary view. */
export const DEFAULT_FEATURE_GRAPH_LIMIT = 30;

/** One feature in the summary view — the domain without its file list. */
export interface FeatureDomainSummary {
  /** Project-relative path of the feature hub file. */
  hub: string;
  /** Number of internal imports the hub has. */
  outDegree: number;
  /** Number of files the hub owns. */
  fileCount: number;
}

/** Token-bounded view of a {@link FeatureGraph}: counts per feature, no file lists. */
export interface FeatureGraphSummary {
  /** The largest features (by owned files), at most `limit` of them. */
  features: Record<string, FeatureDomainSummary>;
  /** Total features before the cap. */
  totalFeatures: number;
  /** Files not owned by any hub. */
  unassignedCount: number;
  /** Present (true) only when `features` was cut short by `limit`. */
  truncated?: true;
  /** How to get more detail. */
  hint: string;
}

/**
 * @description Reduces a {@link FeatureGraph} to per-feature counts, keeping the `limit` features that
 *   own the most files. Always reports the true feature total and unassigned count.
 * @param {FeatureGraph} featureGraph - Full feature graph from {@link buildFeatureGraph}.
 * @param {{ limit?: number }} [options] - `limit` caps the features listed (default 30); non-finite or < 1 falls back to the default.
 * @returns {FeatureGraphSummary} Counts-only summary with a `hint` pointing at `feature` / `view:"full"`.
 */
export function summarizeFeatureGraph(
  featureGraph: FeatureGraph,
  options?: { limit?: number | undefined },
): FeatureGraphSummary {
  const requested = options?.limit;
  const limit =
    requested !== undefined && Number.isFinite(requested) && requested >= 1
      ? Math.trunc(requested)
      : DEFAULT_FEATURE_GRAPH_LIMIT;
  const ranked = Array.from(featureGraph.features.entries()).sort(
    (a, b) => b[1].files.length - a[1].files.length,
  );
  const kept = ranked.slice(0, limit);
  const truncated = kept.length < ranked.length;
  const features: Record<string, FeatureDomainSummary> = {};
  for (const [name, domain] of kept) {
    features[name] = {
      hub: domain.hub,
      outDegree: domain.outDegree,
      fileCount: domain.files.length,
    };
  }
  return {
    features,
    totalFeatures: ranked.length,
    unassignedCount: featureGraph.unassigned.length,
    ...(truncated && { truncated: true as const }),
    hint: 'Pass feature:"<name>" for one feature\'s file list, raise limit for more features, or view:"full" for every file.',
  };
}

/**
 * Builds a domain-clustered view of the import graph by grouping files under
 * the most specific feature hub that can reach them.
 *
 * Assignment rule: each file is assigned to the hub with the lowest out-degree
 * that can transitively reach it (overridable via `options.hubComparator`).
 *
 * @param graph - The import graph to cluster.
 * @param options - Controls hub detection threshold, assignment comparator, and detectFn override.
 * @returns A `FeatureGraph` with one domain per hub and an `unassigned` list.
 */
export function buildFeatureGraph(graph: Graph, options?: FeatureGraphOptions): FeatureGraph {
  const detectFn = options?.detectFn ?? detectFeatures;
  const comparator = options?.hubComparator ?? DEFAULT_HUB_COMPARATOR;
  const hubs = detectFn(graph.nodes, options);
  const reachable = collectReachable(graph, hubs);
  const fileToHub = assignFilesToHubs(graph.nodes, hubs, reachable, comparator);
  return {
    features: buildDomains(hubs, fileToHub),
    unassigned: collectUnassigned(graph.nodes, hubs, fileToHub),
  };
}
