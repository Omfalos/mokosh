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
 * Counts how many internal imports each file has.
 *
 * @param nodes All file nodes in the dependency graph, keyed by file path.
 * @returns     Map from file path to its internal import count (out-degree).
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
 * Filters an out-degree map down to the files that qualify as features.
 *
 * @param nodes        All file nodes in the dependency graph, keyed by file path.
 * @param outDegreeMap Pre-computed import counts for every file.
 * @param minOutDegree Minimum out-degree a file must reach to be included.
 * @returns            Map of qualifying feature files; empty if none qualify.
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
 * Scans the dependency graph and promotes files with many imports to "features".
 *
 * **Algorithm (two passes)**
 * 1. Count how many internal imports each file has (its *out-degree*).
 * 2. Keep only non-test, non-barrel files whose out-degree meets `minOutDegree`.
 *
 * The result is a map from file path → {@link FeatureInfo}, ready for
 * tag generation or graph annotation.
 *
 * @param nodes   All file nodes in the dependency graph, keyed by file path.
 * @param options Tuning knobs — currently just `minOutDegree`.
 * @returns       Map of detected feature files; empty if none qualify.
 */
export function detectFeatures(
  nodes: Map<string, FileNode>,
  options?: FeatureDetectionOptions,
): Map<string, FeatureInfo> {
  const minOutDegree = options?.minOutDegree ?? 5;

  return buildFeatureMap(nodes, buildOutDegreeMap(nodes), minOutDegree);
}
