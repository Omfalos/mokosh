import path from "node:path";
import {
  type ApiSurface,
  buildApiSurface,
  buildFeatureGraph,
  buildResponsibilityGraph,
  buildTypeGraph,
  detectAllEntryPoints,
  detectFeatures,
  type Graph,
  languageSupportNote,
  type PublicExport,
  queryTypeGraph,
  summarizeApiSurface,
  summarizeFeatureGraph,
  summarizeFeatures,
  summarizeTypeInventory,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import { tagPackage } from "./fanout";
import type {
  DetectFeaturesArgs,
  GetApiSurfaceArgs,
  GetFeatureGraphArgs,
  GetModuleResponsibilityArgs,
  GetTypeGraphArgs,
} from "./types";

/**
 * @description Identifies feature hub files — source files with high out-degree (many imports) —
 *   sorted by out-degree descending. Builds from `entryPoints` when provided, else reuses the cached graph.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root` is the project directory; `entryPoints` optionally seeds a fresh build; `featureThreshold` sets the minimum out-degree to qualify.
 * @returns TextResponse with `{ features, count, matched, truncated?, hint? }`, `features` capped at `limit` (default 50) and sorted by out-degree descending.
 */
export async function handleDetectFeatures(
  cache: SessionState,
  args: DetectFeaturesArgs,
): Promise<TextResponse> {
  const { root, entryPoints, featureThreshold, package: pkg, limit } = args;
  const opts = featureThreshold !== undefined ? { minOutDegree: featureThreshold } : undefined;

  if (entryPoints) {
    const graph = await cache.getOrBuild(
      root,
      entryPoints.map((ep) => path.resolve(root, ep)),
    );
    const featureMap = detectFeatures(graph.nodes, opts);
    const features = Array.from(featureMap.values()).sort((a, b) => b.outDegree - a.outDegree);
    return text(summarizeFeatures(features, { limit }));
  }

  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const features = graphs
    .flatMap(({ graph, package: pkgName }) =>
      tagPackage(Array.from(detectFeatures(graph.nodes, opts).values()), pkgName, multi),
    )
    .sort((a, b) => b.outDegree - a.outDegree);
  return text(summarizeFeatures(features, { limit }));
}

/**
 * @description Returns type-level relationships for the project. Without `type`, returns an inventory
 *   of all interfaces, classes, enums, and type aliases. With `type`, returns which files import that
 *   type and which types the defining file itself imports. On a monorepo root this spans the whole
 *   workspace (flattened graph); pass `package` to scope it to one. Requires a prior `analyze` call.
 *   Type extraction is only supported for some languages (see `docs/language-support.md`) — both the
 *   inventory and the named-lookup form attach a `note` explaining this when the graph has no
 *   supported language present, rather than returning an indistinguishable "not found" result.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `type` is the exact exported name to look up (omit for the inventory); `limit`/`kind`/`path` bound and filter the inventory; `package` scopes to one workspace package.
 * @returns TextResponse with either a bounded type inventory (`{ count, matched, byKind, types, truncated?, hint? }`, docs cut to their first line) or a focused `TypeQueryResult`, each with an optional `note`.
 */
export async function handleGetTypeGraph(
  cache: SessionState,
  args: GetTypeGraphArgs,
): Promise<TextResponse> {
  const { root, type, package: pkg, limit, kind, path: pathFilter } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
  const typeGraph = buildTypeGraph(graph);
  if (type) {
    const result = queryTypeGraph(typeGraph, type);
    // languageSupportNote returns undefined whenever the graph has at least one file type that
    // does support typeGraph extraction, so this is a no-op (and costs nothing extra to check)
    // for the common "type name just doesn't exist" case — it only fires when result.type is
    // null *because* no language present supports typeGraph at all, which the no-arg inventory
    // branch below already surfaces but this named-lookup branch previously left silent (a
    // caller using only this form had no way to tell "not found" from "not supported").
    const note = result.type === null ? languageSupportNote(graph, "typeGraph") : undefined;
    return text({ ...result, ...(note && { note }) });
  }
  const inventory = summarizeTypeInventory(typeGraph, { limit, kind, path: pathFilter });
  const note = typeGraph.types.size === 0 ? languageSupportNote(graph, "typeGraph") : undefined;
  return text({ ...inventory, ...(note && { note }) });
}

/**
 * @description Returns what each file is responsible for: its semantic role, JSDoc description,
 *   exported symbol names, and which feature hub it belongs to. Pass `paths` to filter to specific
 *   files, or omit to get all files. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `paths` filters to specific files; `minOutDegree` tunes hub detection.
 * @returns TextResponse with `{ count, modules }` where each module includes its role, description, and exports.
 */
export async function handleGetModuleResponsibility(
  cache: SessionState,
  args: GetModuleResponsibilityArgs,
): Promise<TextResponse> {
  const { root, paths, minOutDegree, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const opts = minOutDegree !== undefined ? { minOutDegree } : undefined;
  const modules = graphs.flatMap(({ graph, package: pkgName }) => {
    const respGraph = buildResponsibilityGraph(graph, opts);
    const found = paths?.length
      ? paths
          .map((modulePath) => respGraph.get(modulePath))
          .filter((module): module is NonNullable<typeof module> => !!module)
      : Array.from(respGraph.values());
    return tagPackage(found, pkgName, multi);
  });
  return text({ count: modules.length, modules });
}

/**
 * @description Groups files into feature domains under their respective hub files (high-import
 *   orchestrators). Each file is assigned to the most specific hub that can transitively reach it.
 *   Returns only paths grouped by hub — substantially smaller than a full graph query for the same
 *   domain-based question, though the exact reduction depends on the repo's shape.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `minOutDegree` sets the minimum internal imports to qualify as a hub; `view` (`summary` default | `full`) picks counts-only vs every file; `limit` caps the summary; `feature` returns one feature's full file list.
 * @returns TextResponse: by default `{ features: {name: {hub, outDegree, fileCount}}, totalFeatures, unassignedCount, truncated?, hint }`; with `view:"full"`, `{ features, unassigned }` keyed by feature name; with `feature`, that domain's `{ hub, outDegree, files, fileCount }`.
 */
export async function handleGetFeatureGraph(
  cache: SessionState,
  args: GetFeatureGraphArgs,
): Promise<TextResponse> {
  const { root, minOutDegree, package: pkg, view = "summary", limit, feature } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
  const featureGraph = buildFeatureGraph(
    graph,
    minOutDegree !== undefined ? { minOutDegree } : undefined,
  );
  if (feature !== undefined) {
    const domain = featureGraph.features.get(feature);
    if (!domain) {
      return text({
        feature,
        found: false,
        hint: "No such feature. Call without `feature` to list names.",
      });
    }
    return text({ feature, ...domain, fileCount: domain.files.length });
  }
  if (view === "full") {
    return text({
      features: Object.fromEntries(featureGraph.features),
      unassigned: featureGraph.unassigned,
    });
  }
  return text(summarizeFeatureGraph(featureGraph, { limit }));
}

/** JVM (and Go, after language-aware detection) treat every source file as an entry point, so a
 *  surface can carry hundreds of them. Echo at most this many back, with the true `entryPointCount`
 *  alongside — an empty `unreachableFromEntry` next to a large count then reads as "every file is
 *  an entry", not "nothing is separate". */
const MAX_ENTRY_POINTS_ECHOED = 25;

function echoEntryPoints(eps: string[]): {
  entryPoints: string[];
  entryPointCount: number;
  entryPointsTruncated?: true;
} {
  if (eps.length <= MAX_ENTRY_POINTS_ECHOED) {
    return { entryPoints: eps, entryPointCount: eps.length };
  }
  return {
    entryPoints: eps.slice(0, MAX_ENTRY_POINTS_ECHOED),
    entryPointCount: eps.length,
    entryPointsTruncated: true,
  };
}

/**
 * Renders one full `ApiSurface` for a single-surface response (plain root or a single requested
 * `package`), honouring `view`. `"summary"` (default) is a token-bounded projection; `"exports"`
 * adds the full `publicExports`; `"full"` is the complete surface with every path list.
 */
function renderSurface(
  surface: ApiSurface,
  view: GetApiSurfaceArgs["view"],
  maxExports?: number,
): TextResponse {
  if (view === "full") {
    return text({ ...surface, ...echoEntryPoints(surface.entryPoints) });
  }
  const summary = summarizeApiSurface(surface, maxExports === undefined ? {} : { maxExports });
  if (view === "exports") {
    const { publicExportsTruncated: _drop, ...rest } = summary;
    return text({
      ...rest,
      publicExports: surface.publicExports,
      hint: `Pass view:"full" for the internalFiles / testFiles path lists.`,
    });
  }
  return text(summary);
}

export async function handleGetApiSurface(
  cache: SessionState,
  args: GetApiSurfaceArgs,
): Promise<TextResponse> {
  const { root, entryPoints, package: pkg, view = "summary", maxExports } = args;
  const maxExportsPerPackage = args.maxExportsPerPackage ?? 10;

  // Plain (non-monorepo) root.
  if (!cache.isWorkspaceRoot(root)) {
    const graph = await cache.ensureFresh(root);
    const eps = entryPoints?.length ? entryPoints : detectAllEntryPoints(graph, root);
    if (eps.length === 0) {
      throw new Error(
        "No entry points found. Pass entryPoints explicitly, or (JS) ensure package.json has a main/exports field.",
      );
    }
    return renderSurface(buildApiSurface(graph, eps), view, maxExports);
  }

  // Monorepo root: one surface per package. Entry points come from the WorkspaceGraph the
  // detectors already resolved per package (relative to each package's own root), or from an
  // explicit `entryPoints` arg — either way filtered to files actually present in that
  // package's graph, so a package that contributes none is skipped, never thrown on.
  const wg = await cache.ensureFreshWorkspace(root);
  const graphs = await cache.resolveGraphs(root, pkg); // validates `pkg`, restricts to own files

  const surfaceFor = (pkgName: string, graph: Graph): ApiSurface | null => {
    const candidates = entryPoints?.length
      ? entryPoints
      : (wg.packages.get(pkgName)?.pkg.entryPoints ?? []).map((ep) => path.relative(root, ep));
    const eps = candidates.filter((ep) => graph.nodes.has(ep));
    return eps.length ? buildApiSurface(graph, eps) : null;
  };

  // A single package was requested → return its surface (summary-first, `view`-controlled).
  if (graphs.length === 1) {
    const only = graphs[0];
    if (!only) throw new Error("get_api_surface: no graph resolved for this root.");
    const surface = surfaceFor(only.package, only.graph);
    if (!surface) {
      throw new Error(
        `No entry point for package "${only.package}" is present in the analyzed graph. Pass entryPoints explicitly.`,
      );
    }
    return renderSurface(surface, view, maxExports);
  }

  // Every package → capped per-package breakdown; packages with no entry point are listed in
  // `skipped`. Deliberately compact so a 30+-package monorepo stays well under an MCP token cap:
  // no per-package path lists (counts only), and each exported symbol is just `name` + `kind`
  // (call get_api_surface with `package` for one package's full surface). `maxExportsPerPackage:
  // 0` drops the `publicExports` sample entirely — a counts-only mode.
  interface PackageApiSummary {
    package: string;
    entryPointCount: number;
    publicExportCount: number;
    publicExports?: Array<{ name: string; kind: PublicExport["kind"] }>;
    internalFileCount: number;
    unreachableFromEntryCount: number;
    testFileCount: number;
  }
  const packages: PackageApiSummary[] = [];
  const skipped: Array<{ package: string; reason: string }> = [];
  let truncated = false;

  for (const { package: pkgName, graph } of graphs) {
    const surface = surfaceFor(pkgName, graph);
    if (!surface) {
      skipped.push({
        package: pkgName,
        reason: "no entry point resolvable from the WorkspaceGraph",
      });
      continue;
    }
    const summary: PackageApiSummary = {
      package: pkgName,
      entryPointCount: surface.entryPoints.length,
      publicExportCount: surface.publicExports.length,
      internalFileCount: surface.internalFiles.length,
      unreachableFromEntryCount: surface.unreachableFromEntry.length,
      testFileCount: surface.testFiles.length,
    };
    if (maxExportsPerPackage > 0) {
      summary.publicExports = surface.publicExports
        .slice(0, maxExportsPerPackage)
        .map((exp) => ({ name: exp.name, kind: exp.kind }));
      if (summary.publicExports.length < surface.publicExports.length) truncated = true;
    } else if (surface.publicExports.length > 0) {
      truncated = true;
    }
    packages.push(summary);
  }
  return text({ packages, skipped, truncated });
}
