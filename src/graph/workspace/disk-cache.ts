/** Disk persistence for the monorepo workspace graph: a small `manifest.json` ("the map file")
 *  plus one `<pkg-slug>.json` per package. Each package file is read and `JSON.parse`d on its
 *  own, so hydrate peak memory is bounded by the largest single package rather than the whole
 *  serialized workspace — the previous single `workspace-graph.json` (190 MB+ on large repos)
 *  was parsed in one shot and OOM-killed the MCP server. Load is all-or-nothing: any stale,
 *  oversized, or missing package discards the whole cache and the caller does a full rebuild. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WORKSPACE_CACHE_SUBDIR,
  DEFAULT_WORKSPACE_GRAPH_CACHE_FILE,
  MAX_PACKAGE_CACHE_BYTES,
  WORKSPACE_CACHE_VERSION,
  WORKSPACE_MANIFEST_FILE,
} from "../../const";
import { computeWorkspacePackageDigests } from "../../index";
import { Graph } from "../model";
import { type SerializedWorkspaceGraph, WorkspaceGraph } from "../workspace-model";

/** One package's entry in the manifest — everything needed to locate its cache file and decide
 *  whether that file is still current, without opening it. */
interface ManifestPackage {
  name: string;
  relativeRoot: string;
  entryPoints: string[];
  /** Filename within the workspace cache subdir; absent when `skipped` is true. */
  file?: string;
  /** Per-package source digest (`computeWorkspacePackageDigests`) at write time. */
  digest: string;
  nodeCount: number;
  /** `true` when the package's serialized nodes exceeded `MAX_PACKAGE_CACHE_BYTES` and were not
   *  written — the package is unconditionally stale on read, forcing a rebuild. */
  skipped?: boolean;
}

/** The `manifest.json` shape. */
interface WorkspaceCacheManifest {
  version: number;
  monorepoRoot: string;
  type: string;
  /** Digest over source files owned by no package (root configs, lockfiles, root docs). */
  rootDigest: string;
  packages: ManifestPackage[];
}

/** Absolute path of the workspace cache subdirectory for `cacheDir` (the resolved `mokosh-cache`). */
function subdir(cacheDir: string): string {
  return path.join(cacheDir, DEFAULT_WORKSPACE_CACHE_SUBDIR);
}

/** A filesystem-safe, collision-resistant filename for a package's cache file. Package names can
 *  contain `/`, `@`, `.` (`@org/app`, `./packages/x`) — slug the readable part for humans, append
 *  a short hash of the full name so two packages never map to the same file. */
function packageFileName(name: string): string {
  const slug = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pkg";
  const hash = crypto.createHash("sha1").update(name).digest("hex").slice(0, 8);
  return `${slug}-${hash}.json`;
}

/** Best-effort removal of the legacy single-blob `workspace-graph.json` for `cacheDir`. Older
 *  mokosh versions wrote it; nothing reads it any more and it is the file that caused the OOM. */
function unlinkLegacyBlob(cacheDir: string): void {
  try {
    fs.rmSync(path.join(cacheDir, DEFAULT_WORKSPACE_GRAPH_CACHE_FILE), { force: true });
  } catch {
    // Non-fatal: a leftover legacy file only wastes disk, it is never read.
  }
}

/**
 * @description Persists `wg` under `cacheDir` as a manifest plus one file per package. Packages
 *   whose serialized node array exceeds `MAX_PACKAGE_CACHE_BYTES` are recorded as `skipped` and
 *   not written (they rebuild every time, but a giant `JSON.parse` is never attempted). The
 *   manifest is written last, so a crash mid-write never leaves a manifest pointing at a missing
 *   file. Orphaned package files from a previous write are removed. Never throws — a write
 *   failure (read-only fs, etc.) is reported via `onWarn` and otherwise ignored, since this is a
 *   pure acceleration and must not fail the operation that triggered it.
 * @param cacheDir - The resolved `mokosh-cache` directory.
 * @param files - A pre-computed `getAllProjectFiles(monorepoRoot)` result (from
 *   `computeWorkspaceSourceDigest`), reused so the tree is not re-walked.
 * @param wg - The workspace graph to serialize.
 * @param onWarn - Called with a human-readable message on any non-fatal write failure.
 */
export function saveWorkspaceCache(
  cacheDir: string,
  files: string[],
  wg: WorkspaceGraph,
  onWarn: (message: string) => void = () => {},
): void {
  try {
    const dir = subdir(cacheDir);
    fs.mkdirSync(dir, { recursive: true });

    const serialized: SerializedWorkspaceGraph = wg.serialize();
    const { rootDigest, packageDigests } = computeWorkspacePackageDigests(
      wg.monorepoRoot,
      serialized.packages.map(({ pkg }) => pkg),
      files,
    );

    const manifestPackages: ManifestPackage[] = [];
    const keepFiles = new Set<string>([WORKSPACE_MANIFEST_FILE]);
    for (const { pkg, nodes } of serialized.packages) {
      const digest = packageDigests.get(pkg.name) ?? "";
      const body = JSON.stringify({ nodes });
      if (Buffer.byteLength(body) > MAX_PACKAGE_CACHE_BYTES) {
        manifestPackages.push({
          name: pkg.name,
          relativeRoot: pkg.relativeRoot,
          entryPoints: pkg.entryPoints,
          digest,
          nodeCount: nodes.length,
          skipped: true,
        });
        continue;
      }
      const file = packageFileName(pkg.name);
      fs.writeFileSync(path.join(dir, file), body);
      keepFiles.add(file);
      manifestPackages.push({
        name: pkg.name,
        relativeRoot: pkg.relativeRoot,
        entryPoints: pkg.entryPoints,
        file,
        digest,
        nodeCount: nodes.length,
      });
    }

    // Drop package files left over from a previous write with a different package set.
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".json") && !keepFiles.has(entry)) {
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    }

    const manifest: WorkspaceCacheManifest = {
      version: WORKSPACE_CACHE_VERSION,
      monorepoRoot: wg.monorepoRoot,
      type: wg.type,
      rootDigest,
      packages: manifestPackages,
    };
    fs.writeFileSync(path.join(dir, WORKSPACE_MANIFEST_FILE), JSON.stringify(manifest));
    unlinkLegacyBlob(cacheDir);
  } catch (err) {
    onWarn(`failed to persist workspace graph cache: ${err}`);
  }
}

/**
 * @description Hydrates a `WorkspaceGraph` from `cacheDir` — but only if every package's cache
 *   file is present and its stored per-package digest still matches the live tree, and the
 *   root (non-package) digest matches too. Any mismatch, a `skipped` package, a missing or
 *   unreadable file, a manifest version bump, or a corrupt manifest all degrade to `null` (the
 *   caller does a full rebuild). Never throws.
 * @param cacheDir - The resolved `mokosh-cache` directory.
 * @param files - A pre-computed `getAllProjectFiles(monorepoRoot)` result, reused for the
 *   per-package digest comparison so the tree is walked only once.
 * @returns The deserialized `WorkspaceGraph`, or `null`.
 */
export function loadWorkspaceCache(cacheDir: string, files: string[]): WorkspaceGraph | null {
  try {
    const dir = subdir(cacheDir);
    const manifestPath = path.join(dir, WORKSPACE_MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as WorkspaceCacheManifest;
    if (manifest.version !== WORKSPACE_CACHE_VERSION || !Array.isArray(manifest.packages)) {
      return null;
    }

    const { rootDigest, packageDigests } = computeWorkspacePackageDigests(
      manifest.monorepoRoot,
      manifest.packages.map((pkg) => ({ name: pkg.name, relativeRoot: pkg.relativeRoot })),
      files,
    );
    if (rootDigest !== manifest.rootDigest) return null;

    const wg = new WorkspaceGraph(manifest.monorepoRoot, manifest.type);
    for (const pkg of manifest.packages) {
      if (pkg.skipped || !pkg.file) return null;
      if (packageDigests.get(pkg.name) !== pkg.digest) return null;
      const body = fs.readFileSync(path.join(dir, pkg.file), "utf-8");
      const { nodes } = JSON.parse(body) as SerializedWorkspaceGraph["packages"][number];
      const graph = new Graph(new Map(nodes.map((node) => [node.path, node])));
      // `root` is not persisted and not needed post-build — mirrors `WorkspaceGraph.deserialize`.
      wg.addPackage(
        { name: pkg.name, relativeRoot: pkg.relativeRoot, entryPoints: pkg.entryPoints, root: "" },
        graph,
      );
    }
    return wg;
  } catch {
    return null;
  }
}
