import type { ImportEdge } from "../types/node";

/**
 * @description Tracks which exported symbols of each visited node are "affected" by a change.
 *
 * Enables symbol-level pruning during graph traversal: if a node only imports `foo` and `foo`
 * was not among the changed symbols, that node is not considered affected and traversal stops there.
 */
export class SymbolTraversalContext {
  private affectedSymbols = new Map<string, Set<string>>();

  /**
   * @param {string} startPath - Relative path of the changed file; seeded with the given affected symbols.
   * @param {string[]} affectedSymbols - Symbol names that are considered changed. Pass `["*"]` to treat the whole file as changed.
   */
  constructor(startPath: string, affectedSymbols: string[]) {
    // Callers that want namespace-import consumers to always be affected should include "*" explicitly.
    this.affectedSymbols.set(startPath, new Set(["default", ...affectedSymbols]));
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
