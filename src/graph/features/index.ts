/** Detects feature-hub files — high-out-degree orchestrators that import many other files — from a dependency graph. */
import path from "node:path";
import type { FileNode } from "../../types/node";

/** Controls how aggressively `detectFeatures` promotes files to features. */
export interface FeatureDetectionOptions {
  /**
   * Minimum number of internal imports a file must have before it is
   * considered a feature. Lower values surface more candidates;
   * higher values keep the list focused on true feature aggregators.
   * @default 5
   */
  minOutDegree?: number;
}

/**
 * A file identified as a feature hub — a non-test file with high out-degree
 * (imports many internal modules), acting as an orchestrator or aggregator.
 */
export interface FeatureInfo {
  /** Absolute (or project-relative) path of the feature file. */
  path: string;
  /** How many internal files this file imports (its out-degree in the dep graph). */
  outDegree: number;
  /** Auto-generated tag of the form `feature:<basename>`, used for queries and reports. */
  tag: string;
}

/**
 * @description Counts how many internal imports each file has, producing the raw out-degree data
 *   used by `buildFeatureMap` to filter feature candidates.
 * @param {Map<string, FileNode>} nodes - All file nodes in the dependency graph, keyed by file path.
 * @returns {Map<string, number>} Map from file path to its internal import count (out-degree).
 */
function buildOutDegreeMap(nodes: Map<string, FileNode>): Map<string, number> {
  const outDegreeMap = new Map<string, number>();
  for (const [filePath, node] of nodes) {
    const count = node.imports.filter((imp) => imp.toPath && !imp.isExternal).length;
    if (count > 0) {
      outDegreeMap.set(filePath, count);
    }
  }
  return outDegreeMap;
}

/**
 * @description Filters an out-degree map down to the non-test, non-barrel files whose import
 *   count meets `minOutDegree`, then builds the `FeatureInfo` record for each.
 * @param {Map<string, FileNode>} nodes - All file nodes in the dependency graph, keyed by file path.
 * @param {Map<string, number>} outDegreeMap - Pre-computed internal import counts for every file.
 * @param {number} minOutDegree - Minimum out-degree a file must reach to be included.
 * @returns {Map<string, FeatureInfo>} Map of qualifying feature files; empty if none qualify.
 */
function buildFeatureMap(
  nodes: Map<string, FileNode>,
  outDegreeMap: Map<string, number>,
  minOutDegree: number,
): Map<string, FeatureInfo> {
  const result = new Map<string, FeatureInfo>();
  for (const [filePath, outDegree] of outDegreeMap) {
    if (outDegree < minOutDegree) continue;
    const node = nodes.get(filePath);
    if (!node || node.category === "test" || node.category === "barrel") continue;
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    const label = basename === "index" ? path.basename(path.dirname(filePath)) : basename;
    result.set(filePath, { path: filePath, outDegree, tag: `feature:${label}` });
  }
  return result;
}

/**
 * @description Scans the dependency graph and promotes non-test, non-barrel files with many
 *   imports to "feature hubs". Uses a two-pass approach: first count out-degrees, then filter
 *   and annotate. The result maps file path → `FeatureInfo` for tag generation or graph annotation.
 * @param {Map<string, FileNode>} nodes - All file nodes in the dependency graph, keyed by file path.
 * @param {FeatureDetectionOptions} [options] - Tuning knobs; currently just `minOutDegree` (default 5).
 * @returns {Map<string, FeatureInfo>} Map of detected feature files; empty if none qualify.
 */
export function detectFeatures(
  nodes: Map<string, FileNode>,
  options?: FeatureDetectionOptions,
): Map<string, FeatureInfo> {
  const minOutDegree = options?.minOutDegree ?? 5;

  return buildFeatureMap(nodes, buildOutDegreeMap(nodes), minOutDegree);
}
