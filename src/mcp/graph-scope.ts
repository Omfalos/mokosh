import { type FlatWorkspaceGraph, Graph, packageOwnsFile, type WorkspacePackage } from "../index";

/**
 * @description Builds a `Graph` containing only the nodes that fall under `pkg`'s own
 *   `relativeRoot`. Each package's `Graph` (built independently by `createWorkspaceGraph`) also
 *   contains a node for every cross-package file it imports — needed so traversal from within
 *   that package reaches them — but a whole-graph tool fanning out across every package must not
 *   list those borrowed nodes as if they belonged here too, or a file imported by two packages
 *   would be double-reported. Used by `resolveGraphs`; not by `resolveGraphForFile`, whose
 *   traversal-based tools (get_dependencies et al.) need those borrowed nodes reachable.
 * @param graph - A workspace package's own `Graph`.
 * @param pkg - That package's metadata, for its `relativeRoot` prefix.
 * @returns A new `Graph` restricted to nodes under `pkg.relativeRoot`.
 */
export function restrictToOwnFiles(graph: Graph, pkg: WorkspacePackage): Graph {
  const owned = new Map([...graph.nodes].filter(([nodePath]) => packageOwnsFile(nodePath, pkg)));
  return new Graph(owned);
}

/**
 * @description Narrows a {@link FlatWorkspaceGraph} to just the nodes owned by `pkgName`,
 *   keeping the `packageOf` entries in sync. Used when a whole-workspace tool is scoped to one
 *   package via a `package` arg.
 * @param flat - The flattened workspace graph.
 * @param pkgName - The package to keep.
 * @returns A new `FlatWorkspaceGraph` containing only that package's nodes.
 */
export function restrictFlatToPackage(
  flat: FlatWorkspaceGraph,
  pkgName: string,
): FlatWorkspaceGraph {
  const nodes = new Map(
    [...flat.graph.nodes].filter(([nodePath]) => flat.packageOf.get(nodePath) === pkgName),
  );
  const packageOf = new Map([...flat.packageOf].filter(([nodePath]) => nodes.has(nodePath)));
  return { graph: new Graph(nodes), packageOf };
}
