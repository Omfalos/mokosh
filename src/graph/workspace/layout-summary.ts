/** Cheap monorepo summary derived from the detected layout + package manifests, with no
 *  dependency-graph build. Powers the fast `get_workspace_packages` path (see
 *  docs/known_issues/01-monorepo-workspace-packages-timeout.md, fix 1F). */
import fs from "node:fs";
import path from "node:path";
import type { WorkspaceGraph } from "../workspace-model";
import type { MonorepoLayout } from "./types";

/** Manifest fields scanned for sibling-package references when deriving `dependsOn` without a graph. */
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

export interface WorkspaceLayoutPackageSummary {
  name: string;
  relativeRoot: string;
  /** Sibling workspace packages this one depends on. Exact when `dependsOnResolved`, best-effort otherwise. */
  dependsOn: string[];
  /** Present only when a built workspace graph was available. */
  nodeCount?: number;
}

export interface WorkspaceLayoutSummary {
  monorepoType: string;
  monorepoTypes: string[];
  packageCount: number;
  packages: WorkspaceLayoutPackageSummary[];
  /** `true` when `dependsOn` came from a built graph or every package exposed a manifest. */
  dependsOnResolved: boolean;
  /** `true` when per-package `nodeCount` is populated (a built graph was available). */
  nodeCountsResolved: boolean;
  note?: string;
}

/**
 * @description Reads `<pkgRoot>/package.json` and returns the union of its dependency-field keys.
 * @param pkgRoot - Absolute path to the package directory.
 * @returns Declared dependency names, or `null` when no readable manifest exists (e.g. JVM modules).
 */
function readManifestDeps(pkgRoot: string): Set<string> | null {
  try {
    const raw = fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8");
    const manifest = JSON.parse(raw) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of DEP_FIELDS) {
      const section = manifest[field];
      if (section && typeof section === "object") {
        for (const dep of Object.keys(section as Record<string, unknown>)) names.add(dep);
      }
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * @description Summarizes a monorepo from its detected layout alone — package names, relative
 *   roots, and best-effort `dependsOn` from `package.json` manifests — without building any
 *   dependency graph. When a built `WorkspaceGraph` is supplied, its exact per-package node
 *   counts and cross-package edges are used instead.
 * @param layout - The result of `detectMonorepo`. Must not be `type: "none"`.
 * @param builtGraph - An already-built workspace graph for `layout.root`, if one is cached.
 * @returns A layout summary suitable for the `get_workspace_packages` response.
 */
export function summarizeWorkspaceLayout(
  layout: MonorepoLayout,
  builtGraph?: WorkspaceGraph,
): WorkspaceLayoutSummary {
  if (builtGraph) {
    // Same shape as `summarizeWorkspacePackages`, inlined to keep this module off the
    // `queries.ts` import path (it would otherwise close a cycle through the workspace barrel).
    const pkgDeps = builtGraph.getPackageDependencies();
    const packages = Array.from(builtGraph.packages.values()).map(({ graph, pkg }) => ({
      name: pkg.name,
      relativeRoot: pkg.relativeRoot,
      dependsOn: pkgDeps.get(pkg.name) ?? [],
      nodeCount: graph.nodes.size,
    }));
    return {
      monorepoType: layout.type,
      monorepoTypes: layout.types,
      packageCount: packages.length,
      packages,
      dependsOnResolved: true,
      nodeCountsResolved: true,
    };
  }

  const siblingNames = new Set(layout.packages.map((pkg) => pkg.name));
  let everyManifestReadable = true;

  const packages: WorkspaceLayoutPackageSummary[] = layout.packages.map((pkg) => {
    const declared = readManifestDeps(pkg.root);
    if (declared === null) {
      everyManifestReadable = false;
      return { name: pkg.name, relativeRoot: pkg.relativeRoot, dependsOn: [] };
    }
    const dependsOn = [...declared]
      .filter((dep) => dep !== pkg.name && siblingNames.has(dep))
      .sort();
    return { name: pkg.name, relativeRoot: pkg.relativeRoot, dependsOn };
  });

  return {
    monorepoType: layout.type,
    monorepoTypes: layout.types,
    packageCount: packages.length,
    packages,
    dependsOnResolved: everyManifestReadable,
    nodeCountsResolved: false,
    note: "Layout only — per-package node counts and (for build-system monorepos without package.json) dependency edges require a full graph. Call analyze with empty entryPoints, then get_workspace_packages again.",
  };
}
