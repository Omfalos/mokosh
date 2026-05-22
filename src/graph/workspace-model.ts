import type { FileNode } from "../types/node";
import { Graph } from "./model";
import type { WorkspacePackage } from "./workspace";

export interface SerializedWorkspaceGraph {
  monorepoRoot: string;
  type: string;
  packages: Array<{
    pkg: Omit<WorkspacePackage, "root">;
    nodes: FileNode[];
  }>;
}

/**
 * @description Holds one per-package `Graph` for each workspace package in a monorepo.
 *   Cross-package import edges are preserved inside each graph via `ImportEdge.isWorkspace`.
 *   The workspace graph does not merge all nodes into one flat namespace — each package graph
 *   is queried independently, with cross-package traversal handled by `getAffectedAcrossPackages`.
 */
export class WorkspaceGraph {
  readonly packages: Map<string, { graph: Graph; pkg: WorkspacePackage }> = new Map();

  constructor(
    readonly monorepoRoot: string,
    readonly type: string,
  ) {}

  /** @description Registers a package and its pre-built graph into this workspace. */
  addPackage(pkg: WorkspacePackage, graph: Graph): void {
    this.packages.set(pkg.name, { graph, pkg });
  }

  /**
   * @description Returns the workspace package whose `relativeRoot` is a path prefix of `relPath`.
   */
  getPackageForFile(relPath: string): WorkspacePackage | undefined {
    for (const { pkg } of this.packages.values()) {
      if (relPath === pkg.relativeRoot || relPath.startsWith(`${pkg.relativeRoot}/`)) {
        return pkg;
      }
    }
    return undefined;
  }

  /**
   * @description Returns a map of package-level dependencies derived from workspace import edges.
   *   Key: package name. Value: list of workspace package names it imports from.
   */
  getPackageDependencies(): Map<string, string[]> {
    const deps = new Map<string, string[]>();
    for (const { graph, pkg } of this.packages.values()) {
      const pkgDeps = new Set<string>();
      for (const node of graph.nodes.values()) {
        for (const imp of node.imports) {
          if (imp.isWorkspace && imp.workspacePackage) {
            pkgDeps.add(imp.workspacePackage);
          }
        }
      }
      deps.set(pkg.name, [...pkgDeps]);
    }
    return deps;
  }

  /**
   * @description Cross-package blast-radius analysis. Returns every file (with its package name)
   *   that could be affected if the given monorepo-root-relative path changes.
   *
   *   Step 1: traverse incoming edges within the owning package graph to find intra-package dependents.
   *   Step 2: for each other package that has workspace edges pointing to the owner, surface the
   *   files in that package that hold those edges (the cross-package entry points).
   */
  getAffectedAcrossPackages(relPath: string): Array<{ file: string; package: string }> {
    const ownerPkg = this.getPackageForFile(relPath);
    if (!ownerPkg) return [];

    const ownerEntry = this.packages.get(ownerPkg.name);
    if (!ownerEntry) return [];

    const result: Array<{ file: string; package: string }> = [];

    // Intra-package dependents
    ownerEntry.graph.traverse(
      relPath,
      (node) => {
        if (node.path !== relPath) result.push({ file: node.path, package: ownerPkg.name });
        return true;
      },
      { direction: "incoming" },
    );

    // Cross-package: files in other packages that hold workspace imports into ownerPkg
    for (const { graph, pkg } of this.packages.values()) {
      if (pkg.name === ownerPkg.name) continue;
      for (const node of graph.nodes.values()) {
        const hasEdge = node.imports.some(
          (imp) => imp.isWorkspace && imp.workspacePackage === ownerPkg.name,
        );
        if (hasEdge) result.push({ file: node.path, package: pkg.name });
      }
    }

    return result;
  }

  /** @description Serializes the workspace graph to a plain JSON-safe object. `root` is omitted from package entries as it is not needed after build time. */
  serialize(): SerializedWorkspaceGraph {
    return {
      monorepoRoot: this.monorepoRoot,
      type: this.type,
      packages: Array.from(this.packages.values()).map(({ graph, pkg }) => ({
        pkg: {
          name: pkg.name,
          relativeRoot: pkg.relativeRoot,
          entryPoints: pkg.entryPoints,
        },
        nodes: Array.from(graph.nodes.values()),
      })),
    };
  }

  /** @description Reconstructs a `WorkspaceGraph` from a serialized snapshot. The `root` field on each package is set to an empty string — it is not persisted and not needed for graph traversal. */
  static deserialize(data: SerializedWorkspaceGraph): WorkspaceGraph {
    const wg = new WorkspaceGraph(data.monorepoRoot, data.type);
    for (const { pkg, nodes } of data.packages) {
      const nodeMap = new Map(nodes.map((n) => [n.path, n]));
      const graph = new Graph(nodeMap);
      wg.packages.set(pkg.name, {
        graph,
        pkg: { ...pkg, root: "" }, // root not persisted; not needed post-build
      });
    }
    return wg;
  }
}
