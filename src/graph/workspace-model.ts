/** WorkspaceGraph holds one per-package Graph for a monorepo and exposes cross-package blast-radius queries. */
import type { FileNode } from "../types/node";
import { Graph } from "./model";
import type { WorkspacePackage } from "./workspace/types";

/**
 * @description Whether `relPath` falls under `pkg`'s own `relativeRoot` — i.e. the package owns
 *   that file, as opposed to merely importing it across a package boundary. Each per-package
 *   `Graph` also carries "borrowed" nodes for cross-package files it imports (so outward
 *   traversal reaches them); this predicate is how callers that iterate every package's graph
 *   avoid double-counting a file that two packages both import.
 * @param {string} relPath - A monorepo-root-relative file path.
 * @param {Pick<WorkspacePackage, "relativeRoot">} pkg - The package to test ownership against.
 * @returns {boolean} `true` if `relPath` is `pkg.relativeRoot` or sits beneath it.
 */
export function packageOwnsFile(
  relPath: string,
  pkg: Pick<WorkspacePackage, "relativeRoot">,
): boolean {
  return relPath === pkg.relativeRoot || relPath.startsWith(`${pkg.relativeRoot}/`);
}

/** @description A whole-workspace `Graph` (one namespace, all packages' own nodes, cross-package
 *   edges intact) paired with a path → owning-package-name lookup. Produced by
 *   {@link WorkspaceGraph.flatten}. */
export interface FlatWorkspaceGraph {
  graph: Graph;
  packageOf: Map<string, string>;
}

/** @description Compact, capped cross-package blast radius — the response shape of
 *   {@link WorkspaceGraph.summarizeAffectedAcrossPackages}. */
export interface WorkspaceAffectedSummary {
  /** The changed file the blast radius was computed for. */
  file: string;
  /** Total affected files across every package (the real count, never capped). */
  totalAffected: number;
  /** Number of distinct packages with at least one affected file. */
  packageCount: number;
  /** Per-package breakdown, sorted by `count` descending. */
  byPackage: Array<{
    package: string;
    /** Real affected-file count for this package. */
    count: number;
    /** Up to `maxFilesPerPackage` example paths. */
    sample: string[];
    /** `count - sample.length` — files omitted from `sample`. */
    more: number;
  }>;
  /** `true` if any package's `sample` was capped (`more > 0` somewhere). */
  truncated: boolean;
}

/** @description JSON-safe snapshot of a `WorkspaceGraph`, suitable for writing to disk and restoring via `WorkspaceGraph.deserialize`. */
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

  /** Lazily-built merged view; see {@link flatten}. Never invalidated — a rebuild replaces the
   *  whole `WorkspaceGraph` instance rather than mutating this one. */
  private flattened?: FlatWorkspaceGraph;

  /**
   * @param {string} monorepoRoot - Absolute path to the monorepo root directory.
   * @param {string} type - Primary detected monorepo tool (e.g. `"turborepo"`, `"pnpm"`), or `"none"`.
   */
  constructor(
    readonly monorepoRoot: string,
    readonly type: string,
  ) {}

  /**
   * @description Registers a package and its pre-built graph into this workspace.
   * @param {WorkspacePackage} pkg - Package metadata including name, root, and entry points.
   * @param {Graph} graph - The fully-built dependency graph for this package.
   */
  addPackage(pkg: WorkspacePackage, graph: Graph): void {
    this.packages.set(pkg.name, { graph, pkg });
  }

  /**
   * @description Marks every local import edge that crosses a package boundary as a workspace
   *   edge (`isWorkspace: true`, `workspacePackage` set to the target package name). JS
   *   resolvers tag these at resolution time from the `workspaceMap`, but JVM (and any other
   *   `LangResolver` that resolves cross-module by a project-wide index) returns concrete file
   *   paths with no package awareness — so cross-module Gradle/sbt edges would otherwise be
   *   invisible to `getPackageDependencies` and the cross-package step of
   *   `getAffectedAcrossPackages`. Idempotent: edges already tagged are left untouched.
   *   Call once after all packages are registered.
   */
  annotateCrossPackageEdges(): void {
    for (const { graph } of this.packages.values()) {
      for (const node of graph.nodes.values()) {
        const sourcePkg = this.getPackageForFile(node.path);
        if (!sourcePkg) continue;
        for (const imp of node.imports) {
          if (imp.isExternal || imp.isWorkspace) continue;
          const targetPkg = this.getPackageForFile(imp.toPath);
          if (targetPkg && targetPkg.name !== sourcePkg.name) {
            imp.isWorkspace = true;
            imp.workspacePackage = targetPkg.name;
          }
        }
      }
    }
  }

  /**
   * @description Merges every package's own nodes into a single `Graph` sharing one path
   *   namespace, plus a `path → package name` lookup. "Borrowed" cross-package nodes are
   *   dropped (each is contributed by its owning package instead), so no file appears twice.
   *   Cross-package import edges already carry real monorepo-root-relative `toPath`s, so
   *   `Graph.traverse` and `Graph.findCycles` span package boundaries on the returned graph
   *   with no special-casing — this is the basis for whole-workspace blast radius, call
   *   graphs, symbol search and queries. The graph is read-only: `FileNode`s are shared by
   *   reference with the per-package graphs, never cloned.
   *   Result is memoized for the life of this `WorkspaceGraph`.
   * @returns {FlatWorkspaceGraph} The merged graph and its package lookup.
   */
  flatten(): FlatWorkspaceGraph {
    if (this.flattened) return this.flattened;
    const merged = new Map<string, FileNode>();
    const packageOf = new Map<string, string>();
    for (const { graph, pkg } of this.packages.values()) {
      for (const [nodePath, node] of graph.nodes) {
        if (!packageOwnsFile(nodePath, pkg)) continue;
        merged.set(nodePath, node);
        packageOf.set(nodePath, pkg.name);
      }
    }
    this.flattened = { graph: new Graph(merged), packageOf };
    return this.flattened;
  }

  /**
   * @description Returns the workspace package whose `relativeRoot` is a path prefix of `relPath`.
   * @param {string} relPath - A monorepo-root-relative file path to look up.
   * @returns {WorkspacePackage | undefined} The owning package, or `undefined` if none matches.
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
   * @returns {Map<string, string[]>} Map from package name to the list of workspace packages it depends on.
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
   *   transitively affected if the given monorepo-root-relative path changes — a full incoming
   *   traversal over the flattened whole-workspace graph, so it follows real import edges across
   *   package boundaries. The full, unbounded list: on a large monorepo this can be most of the
   *   repo, so prefer {@link summarizeAffectedAcrossPackages} for an agent-facing response.
   * @param {string} relPath - Monorepo-root-relative path of the changed file.
   * @returns {Array<{ file: string; package: string }>} Each affected file paired with its package name.
   */
  getAffectedAcrossPackages(relPath: string): Array<{ file: string; package: string }> {
    const { graph, packageOf } = this.flatten();
    if (!graph.nodes.has(relPath)) return [];

    const result: Array<{ file: string; package: string }> = [];
    graph.traverse(
      relPath,
      (node) => {
        if (node.path !== relPath) {
          result.push({ file: node.path, package: packageOf.get(node.path) ?? "" });
        }
        return true;
      },
      { direction: "incoming" },
    );
    return result;
  }

  /**
   * @description Agent-friendly form of {@link getAffectedAcrossPackages}: the blast radius
   *   grouped by owning package, with each package's file list capped so the response stays
   *   small even when thousands of files are affected. Packages are sorted by affected count
   *   (descending).
   * @param {string} relPath - Monorepo-root-relative path of the changed file.
   * @param {{ maxFilesPerPackage?: number }} [opts] - `maxFilesPerPackage` caps each package's
   *   `sample` list (default 10; `0` = counts only, no file lists).
   * @returns {WorkspaceAffectedSummary} Totals plus a capped per-package breakdown.
   */
  summarizeAffectedAcrossPackages(
    relPath: string,
    opts: { maxFilesPerPackage?: number } = {},
  ): WorkspaceAffectedSummary {
    const maxFilesPerPackage = opts.maxFilesPerPackage ?? 10;
    const affected = this.getAffectedAcrossPackages(relPath);

    const grouped = new Map<string, string[]>();
    for (const { file, package: pkg } of affected) {
      const list = grouped.get(pkg) ?? [];
      list.push(file);
      grouped.set(pkg, list);
    }

    let truncated = false;
    const byPackage = [...grouped.entries()]
      .map(([pkg, files]) => {
        const sample = files.slice(0, maxFilesPerPackage);
        const more = files.length - sample.length;
        if (more > 0) truncated = true;
        return { package: pkg, count: files.length, sample, more };
      })
      .sort((a, b) => b.count - a.count);

    return {
      file: relPath,
      totalAffected: affected.length,
      packageCount: byPackage.length,
      byPackage,
      truncated,
    };
  }

  /**
   * @description Serializes the workspace graph to a plain JSON-safe object.
   *   `root` is omitted from package entries as it is not needed after build time.
   * @returns {SerializedWorkspaceGraph} A JSON-serializable snapshot of the workspace graph.
   */
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

  /**
   * @description Reconstructs a `WorkspaceGraph` from a serialized snapshot.
   *   The `root` field on each package is set to an empty string — it is not persisted and not needed for graph traversal.
   * @param {SerializedWorkspaceGraph} data - The plain object produced by `serialize`.
   * @returns {WorkspaceGraph} A fully functional `WorkspaceGraph` instance.
   */
  static deserialize(data: SerializedWorkspaceGraph): WorkspaceGraph {
    const wg = new WorkspaceGraph(data.monorepoRoot, data.type);
    for (const { pkg, nodes } of data.packages) {
      const nodeMap = new Map(nodes.map((node) => [node.path, node]));
      const graph = new Graph(nodeMap);
      wg.packages.set(pkg.name, {
        graph,
        pkg: { ...pkg, root: "" }, // root not persisted; not needed post-build
      });
    }
    return wg;
  }
}
