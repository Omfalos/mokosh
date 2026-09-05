/** Analyzes a dependency graph node map for unused files, export-usage hotspots, and circular import chains. */
import type { FileNode } from "../types/node";

/**
 * Edge kinds that {@link GraphAnalyzer.findCycles} treats as *not* real import cycles and skips
 * by default: `"samePackage"` for the synthetic JVM same-package sibling clique, `"docReference"`
 * for Markdown link / code-span file references (ADR-009). Pass one via `includeKinds` to walk it
 * anyway (e.g. a caller that genuinely wants to see doc cross-link loops).
 */
export type CycleEdgeKind = "docReference" | "samePackage";

/** Options for {@link GraphAnalyzer.findCycles}. */
export interface FindCyclesOptions {
  /** Edge kinds to include in the walk that are otherwise skipped (see {@link CycleEdgeKind}). */
  includeKinds?: CycleEdgeKind[] | undefined;
  /** When true, return every raw elementary cycle instead of collapsing cycles that share a
   *  strongly-connected component to one representative each. Default false. */
  expandComponents?: boolean | undefined;
}

/**
 * @description Utility for analyzing the dependency graph for cycles and unused files.
 *   Operates on the raw node map rather than a `Graph` instance so it can be used
 *   without the full traversal infrastructure.
 */
export class GraphAnalyzer {
  /**
   * @param {Map<string, FileNode>} nodes - The full node map of the graph to analyze, keyed by project-relative file path.
   */
  constructor(private nodes: Map<string, FileNode>) {}

  /**
   * @description Returns files from `allFiles` that are absent from the graph — meaning nothing
   *   imports them directly or transitively from any entry point, making them deletion candidates.
   * @param {string[]} allFiles - Complete list of project-relative file paths to test against the graph.
   * @returns {string[]} Subset of `allFiles` whose paths do not appear as graph nodes.
   */
  public findUnusedFiles(allFiles: string[]): string[] {
    const usedFiles = new Set(this.nodes.keys());
    return allFiles.filter((file) => !usedFiles.has(file));
  }

  /**
   * @description Returns files whose highest single-edge export usage ratio meets or exceeds
   *   `threshold`, sorted descending by `maxExportUsage`. Useful for identifying files
   *   that consume a large fraction of one dependency's API surface.
   * @param {number} threshold - Minimum `maxExportUsage` value (0–1) for a file to be included.
   * @returns {Array<{ path: string; maxExportUsage: number; tightestDep: string }>} Entries sorted descending by `maxExportUsage`.
   */
  public findHighExportUsage(
    threshold: number,
  ): Array<{ path: string; maxExportUsage: number; tightestDep: string }> {
    const results: Array<{ path: string; maxExportUsage: number; tightestDep: string }> = [];

    for (const node of this.nodes.values()) {
      if (node.maxExportUsage === undefined || node.maxExportUsage < threshold) continue;
      const tightest = node.imports.reduce(
        (best, imp) => ((imp.exportUsageRatio ?? 0) > (best?.exportUsageRatio ?? 0) ? imp : best),
        null as (typeof node.imports)[number] | null,
      );
      results.push({
        path: node.path,
        maxExportUsage: node.maxExportUsage,
        tightestDep: tightest?.toPath ?? "",
      });
    }

    return results.sort((left, right) => right.maxExportUsage - left.maxExportUsage);
  }

  /**
   * @description The structural-import targets of `nodePath` — the outgoing edges a cycle walk
   *   follows. Excludes unresolved (`!toPath`) and external edges always, and by default the two
   *   non-`import` synthetic edge kinds: the JVM same-package sibling clique (`isSamePackage`) and
   *   Markdown link / code-span file references (`isDocReference`, ADR-009). Both are opt-in via
   *   `include`. Shared by {@link findCycles}' DFS and its strongly-connected-component pass so
   *   the two agree on exactly which edges exist.
   * @param nodePath - The file whose outgoing edges to resolve.
   * @param include - Edge kinds to walk that are otherwise skipped.
   * @returns Deduplicated target paths, in first-seen order.
   */
  private traversableTargets(nodePath: string, include: Set<CycleEdgeKind>): string[] {
    const node = this.nodes.get(nodePath);
    if (!node) return [];
    const seen = new Set<string>();
    for (const imp of node.imports) {
      if (!imp.toPath || imp.isExternal) continue;
      if (imp.isSamePackage && !include.has("samePackage")) continue;
      if (imp.isDocReference && !include.has("docReference")) continue;
      seen.add(imp.toPath);
    }
    return [...seen];
  }

  /**
   * @description Detects all circular import chains using DFS with a recursion-stack back-edge check.
   *   Each returned array is one cycle as an ordered list of file paths ending at the entry that closes the loop.
   *   Non-import edge kinds — the synthetic JVM same-package clique and Markdown doc references
   *   (ADR-009) — are skipped by default; pass `includeKinds` to walk them anyway.
   *
   *   Cycles that share a strongly-connected component are collapsed to one representative each
   *   (the shortest, ties broken lexicographically). A single hub file cyclically bound to N
   *   siblings — e.g. `ItemList.tsx` importing four `*CellRenderer.tsx` that each import a type
   *   back from it — is one dependency knot to untangle, not N findings; the DFS otherwise emits
   *   one back-edge cycle per sibling. Pass `expandComponents` to get every raw elementary cycle
   *   instead.
   * @param {FindCyclesOptions} [opts] - `includeKinds` opts specific edge kinds back into the
   *   walk; `expandComponents` disables the same-component collapse.
   * @returns {string[][]} Array of cycles; each cycle is an ordered list of file paths forming a loop.
   */
  public findCycles(opts: FindCyclesOptions = {}): string[][] {
    const include = new Set(opts.includeKinds ?? []);
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const currentPath: string[] = [];

    const find = (current: string) => {
      visited.add(current);
      recStack.add(current);
      currentPath.push(current);

      for (const target of this.traversableTargets(current, include)) {
        if (recStack.has(target)) {
          // Found a cycle
          const cycleIndex = currentPath.indexOf(target);
          cycles.push([...currentPath.slice(cycleIndex), target]);
        } else if (!visited.has(target)) {
          find(target);
        }
      }

      recStack.delete(current);
      currentPath.pop();
    };

    for (const nodePath of this.nodes.keys()) {
      if (!visited.has(nodePath)) {
        find(nodePath);
      }
    }

    return opts.expandComponents ? cycles : this.collapseByComponent(cycles, include);
  }

  /**
   * @description Collapses `cycles` so that every strongly-connected component contributes at
   *   most one — its shortest cycle, ties broken by the joined path string for determinism.
   *   Every elementary cycle lies wholly within one SCC, so cycles are grouped by the SCC id of
   *   any member; a graph with no repeated-SCC cycles passes through unchanged (order preserved
   *   by first appearance).
   * @param cycles - Raw elementary cycles from the DFS.
   * @param include - Edge kinds in scope, so the SCC pass walks the same edges the DFS did.
   * @returns One representative cycle per SCC that had any, in first-appearance order.
   */
  private collapseByComponent(cycles: string[][], include: Set<CycleEdgeKind>): string[][] {
    if (cycles.length <= 1) return cycles;
    const sccId = this.componentIds(include);

    const bestByScc = new Map<number, string[]>();
    const orderByScc = new Map<number, number>();
    for (const [index, cycle] of cycles.entries()) {
      // `cycle[0]` is on the loop, so it's in a non-trivial SCC; every other member shares it.
      const id = sccId.get(cycle[0] as string);
      if (id === undefined) continue;
      if (!orderByScc.has(id)) orderByScc.set(id, index);
      const current = bestByScc.get(id);
      if (current === undefined || isShorterCycle(cycle, current)) bestByScc.set(id, cycle);
    }

    return [...bestByScc.entries()]
      .sort(([a], [b]) => (orderByScc.get(a) as number) - (orderByScc.get(b) as number))
      .map(([, cycle]) => cycle);
  }

  /**
   * @description Tarjan's strongly-connected-components over the cycle-walk edge set, restricted
   *   to nodes that sit in a component of size ≥ 2 (the only ones that can be on a cycle). Runs
   *   iteratively — the graphs this analyzes reach tens of thousands of nodes, past a safe
   *   recursion depth.
   * @param include - Edge kinds to walk, matching {@link traversableTargets}.
   * @returns Map from file path to a numeric component id, only for nodes in a non-trivial SCC.
   */
  private componentIds(include: Set<CycleEdgeKind>): Map<string, number> {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const tarjanStack: string[] = [];
    const componentOf = new Map<string, number>();
    let counter = 0;
    let componentCount = 0;

    for (const start of this.nodes.keys()) {
      if (index.has(start)) continue;
      // Iterative Tarjan: each work item is a node plus how far its adjacency has been consumed.
      const work: Array<{ node: string; targets: string[]; next: number }> = [
        { node: start, targets: this.traversableTargets(start, include), next: 0 },
      ];
      index.set(start, counter);
      low.set(start, counter);
      counter++;
      tarjanStack.push(start);
      onStack.add(start);

      while (work.length > 0) {
        const frame = work[work.length - 1] as (typeof work)[number];
        if (frame.next < frame.targets.length) {
          const target = frame.targets[frame.next++] as string;
          if (!index.has(target)) {
            index.set(target, counter);
            low.set(target, counter);
            counter++;
            tarjanStack.push(target);
            onStack.add(target);
            work.push({ node: target, targets: this.traversableTargets(target, include), next: 0 });
          } else if (onStack.has(target)) {
            low.set(
              frame.node,
              Math.min(low.get(frame.node) as number, index.get(target) as number),
            );
          }
        } else {
          if (low.get(frame.node) === index.get(frame.node)) {
            const members: string[] = [];
            let popped: string;
            do {
              popped = tarjanStack.pop() as string;
              onStack.delete(popped);
              members.push(popped);
            } while (popped !== frame.node);
            if (members.length > 1) {
              for (const member of members) componentOf.set(member, componentCount);
              componentCount++;
            }
          }
          work.pop();
          const parent = work[work.length - 1];
          if (parent) {
            low.set(
              parent.node,
              Math.min(low.get(parent.node) as number, low.get(frame.node) as number),
            );
          }
        }
      }
    }

    return componentOf;
  }
}

/**
 * @description Cycle ordering for representative selection: fewer files first, then by joined
 *   path string so the choice is deterministic across runs.
 * @param candidate - The cycle being considered.
 * @param incumbent - The current best cycle for the component.
 * @returns `true` when `candidate` should replace `incumbent`.
 */
function isShorterCycle(candidate: string[], incumbent: string[]): boolean {
  if (candidate.length !== incumbent.length) return candidate.length < incumbent.length;
  return candidate.join(" ") < incumbent.join(" ");
}
