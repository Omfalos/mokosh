import { detectFeatures, type FeatureDetectionOptions, type FeatureInfo } from "../graph";
import type { Graph } from "../graph";
import type { ExportedSymbol, FileNode, ImportEdge } from "../types/node";
import { DefaultTestNodeIdentifier, type TestNodeIdentifier } from "./identifier";

/** @description Options for `proposeTags` and `proposeAffectedTests`, allowing callers to override the test-node identifier and feature-detection behaviour. */
export interface ProposeTagsOptions {
  identifier?: TestNodeIdentifier;
  featureDetection?: FeatureDetectionOptions | false;
}

/**
 * @description Materialises optional settings into concrete implementations.
 *
 * The feature map is computed once here so traversal can do O(1) hub lookups
 * rather than re-running detection on every visited node.
 * @param {Graph} graph - The full project dependency graph, needed to run feature detection.
 * @param {ProposeTagsOptions} [options] - Optional identifier and feature-detection overrides.
 * @returns {{ identifier: TestNodeIdentifier; featureMap: Map<string, FeatureInfo> }} Concrete identifier and pre-computed feature map ready for traversal.
 */
function resolveOptions(
  graph: Graph,
  options?: ProposeTagsOptions,
): { identifier: TestNodeIdentifier; featureMap: Map<string, FeatureInfo> } {
  return {
    identifier: options?.identifier ?? new DefaultTestNodeIdentifier(),
    featureMap:
      options?.featureDetection === false
        ? new Map()
        : detectFeatures(graph.nodes, options?.featureDetection ?? undefined),
  };
}

/**
 * @description Walks the incoming dependency graph from each changed file.
 *
 * For every reachable node that passes the symbol-propagation check:
 * - If the node is a feature hub (and not the start node), `onFeatureHub` is
 *   called and that branch is pruned — preventing traversal explosions.
 * - Otherwise `onNode` is called so callers can decide what to collect.
 * @param {Graph} graph - The full project dependency graph.
 * @param {string[]} changedFiles - Relative paths of files that were modified.
 * @param {Map<string, FeatureInfo>} featureMap - Pre-computed map of path → feature hub info.
 * @param {(feature: FeatureInfo) => void} onFeatureHub - Called when a feature hub is encountered; return signals pruning.
 * @param {(node: FileNode) => void} onNode - Called for every non-hub reachable node that passes the symbol check.
 */
function traverseAffected(
  graph: Graph,
  changedFiles: string[],
  featureMap: Map<string, FeatureInfo>,
  onFeatureHub: (feature: FeatureInfo) => void,
  onNode: (node: FileNode) => void,
): void {
  for (const changed of changedFiles) {
    const startNode = graph.nodes.get(changed);
    if (!startNode) continue;

    const context = new TagProposalContext(changed, startNode.exports);

    graph.traverse(
      changed,
      (visitedNode, depth, childPath) => {
        if (!childPath) return true; // start node — always continue

        if (!context.updateAffectedSymbols(visitedNode, childPath)) return false;

        if (depth > 0) {
          const feature = featureMap.get(visitedNode.path);
          if (feature) {
            onFeatureHub(feature);
            return false; // prune: don't walk past this hub
          }
        }

        onNode(visitedNode);
        return true;
      },
      { direction: "incoming" },
    );
  }
}

/**
 * @description Proposes Vitest tags to run based on which files changed.
 *
 * Traverses the incoming dependency graph from each changed file. Test nodes
 * that can reach the changed file contribute their tags. Feature hubs act as
 * boundaries: the hub's tag is emitted and traversal stops there, preventing
 * combinatorial blowup in large graphs.
 * @param {Graph} graph - The full project dependency graph.
 * @param {string[]} changedFiles - Relative paths of files that were modified (e.g. from git diff).
 * @param {ProposeTagsOptions} [options] - Optional: custom test identifier and feature-detection settings.
 * @returns {string[]} Deduplicated list of tag strings to pass to `vitest --grep`.
 */
export function proposeTags(
  graph: Graph,
  changedFiles: string[],
  options?: ProposeTagsOptions,
): string[] {
  const { identifier, featureMap } = resolveOptions(graph, options);
  const proposedTags = new Set<string>();

  // A changed file that is itself a feature hub should immediately emit its tag
  // (it won't appear during incoming traversal since traversal starts from it).
  for (const changed of changedFiles) {
    const feature = featureMap.get(changed);
    if (feature) proposedTags.add(feature.tag);
  }

  traverseAffected(
    graph,
    changedFiles,
    featureMap,
    (feature) => proposedTags.add(feature.tag),
    (node) => {
      if (identifier.isTestNode(node)) {
        for (const tag of node.tags) proposedTags.add(tag.name);
      }
    },
  );

  return Array.from(proposedTags);
}

/**
 * @description Returns the file paths of test files affected by the changed files.
 *
 * Traverses the incoming dependency graph from each changed file and collects
 * paths of reachable test nodes. Feature hubs act as traversal boundaries —
 * tests beyond a hub are excluded because the hub's own tag already covers
 * them when using `proposeTags`.
 *
 * The output is a plain list of relative paths suitable for piping directly
 * into Vitest: `vitest $(mokosh --affected-tests)`.
 * @param {Graph} graph - The full project dependency graph.
 * @param {string[]} changedFiles - Relative paths of files that were modified (e.g. from git diff).
 * @param {ProposeTagsOptions} [options] - Optional: custom test identifier and feature-detection settings.
 * @returns {string[]} Deduplicated list of relative test file paths.
 */
export function proposeAffectedTests(
  graph: Graph,
  changedFiles: string[],
  options?: ProposeTagsOptions,
): string[] {
  const { identifier, featureMap } = resolveOptions(graph, options);
  const affectedTests = new Set<string>();

  traverseAffected(
    graph,
    changedFiles,
    featureMap,
    () => {}, // feature hubs don't contribute test paths — their sub-graph stays pruned
    (node) => {
      if (identifier.isTestNode(node)) {
        affectedTests.add(node.path);
      }
    },
  );

  return Array.from(affectedTests);
}

/**
 * @description Tracks which exported symbols of each visited node are "affected" by a change.
 *
 * Enables symbol-level pruning during traversal: if a node only imports `foo` and `foo`
 * was not among the changed exports, that node is not considered affected and traversal
 * stops there.
 */
class TagProposalContext {
  private affectedSymbols = new Map<string, Set<string>>();

  /**
   * @param {string} startPath - Relative path of the changed file; seeded with all its exports as affected.
   * @param {ExportedSymbol[]} exports - Exported symbols of the changed file, used to initialise the affected set.
   */
  constructor(startPath: string, exports: ExportedSymbol[]) {
    this.affectedSymbols.set(startPath, new Set(["*", "default", ...exports.map((e) => e.name)]));
  }

  /**
   * @description Checks whether `visitedNode` imports any affected symbol from `childPath` and,
   * if so, propagates the affected symbol set to `visitedNode` for the next traversal step.
   *
   * Both roles live in one method to avoid a second pass over the import edges — the check
   * and the update read the same edge, so splitting them would duplicate work.
   * @param {{ path: string; imports: ImportEdge[] }} visitedNode - The node currently being evaluated; its imports are inspected.
   * @param {string} childPath - The path it was reached from; used to look up the current affected symbols.
   * @returns {boolean} `true` if at least one imported symbol is affected and traversal should continue; `false` to prune.
   */
  public updateAffectedSymbols(
    visitedNode: { path: string; imports: ImportEdge[] },
    childPath: string,
  ): boolean {
    const currentSymbols = this.affectedSymbols.get(childPath) || new Set();

    const importEdge = visitedNode.imports.find((imp) => imp.toPath === childPath);
    if (!importEdge) return false;

    const importedSymbols = importEdge.symbols || ["*"];
    const relevantSymbols = new Set<string>();

    for (const sym of importedSymbols) {
      if (sym === "*" || currentSymbols.has("*") || currentSymbols.has(sym)) {
        relevantSymbols.add("*");
      }
    }

    if (relevantSymbols.size === 0) return false;

    const existing = this.affectedSymbols.get(visitedNode.path) || new Set();
    for (const s of relevantSymbols) existing.add(s);
    this.affectedSymbols.set(visitedNode.path, existing);
    return true;
  }
}
