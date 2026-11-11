import path from "node:path";
import {
  filterGraph,
  findSymbol,
  Graph,
  getAffected,
  getCallers,
  getDependencies,
  getDependents,
  getNodeMeta,
  languageCaveats,
  languageSupportNote,
  MermaidExporter,
  parseQuery,
  queryCallGraph,
  queryChangeImpact,
  slimSerialize,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import { tagPackage, withPackageMeta } from "./fanout";
import type {
  FindSymbolArgs,
  GetAffectedArgs,
  GetCallersArgs,
  GetCallGraphArgs,
  GetDependenciesArgs,
  GetDependentsArgs,
  QueryArgs,
} from "./types";

/**
 * @description Outgoing traversal from `file` — returns all files that `file` imports,
 *   up to `depth` hops (default 1 = immediate imports only). Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the starting node; `depth` caps traversal depth; `withMeta` adds category/exports per result.
 * @returns TextResponse with `{ file, dependencies }` listing all reachable imported paths, each
 *   `{ path, symbols? }` or `{ path, symbols?, category, exports }` when `withMeta` is true.
 */
export async function handleGetDependencies(
  cache: SessionState,
  args: GetDependenciesArgs,
): Promise<TextResponse> {
  const { root, file, depth = 1, withMeta = false } = args;
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const deps = getDependencies(graph, file, depth);
  const withMetaDeps = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  const dependencies = withPackageMeta(withMetaDeps, packageOf);
  const caveats = languageCaveats(graph, "importResolution");
  return text({ file, dependencies, ...(caveats.length > 0 && { caveats }) });
}

/**
 * @description Incoming one-hop traversal — returns files that directly import `file`.
 *   For the full transitive upstream set use `handleGetAffected` instead. Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the node whose direct importers to find; `withMeta` adds category/exports per result.
 * @returns TextResponse with `{ file, dependents }` listing files that import `file` directly, each
 *   `{ path, symbols? }` or `{ path, symbols?, category, exports }` when `withMeta` is true.
 */
export async function handleGetDependents(
  cache: SessionState,
  args: GetDependentsArgs,
): Promise<TextResponse> {
  const { root, file, withMeta = false } = args;
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const deps = getDependents(graph, file);
  const withMetaDeps = withMeta
    ? deps.map((dep) => ({ ...dep, ...getNodeMeta(graph, dep.path) }))
    : deps;
  const dependents = withPackageMeta(withMetaDeps, packageOf);
  const caveats = languageCaveats(graph, "importResolution");
  return text({ file, dependents, ...(caveats.length > 0 && { caveats }) });
}

/**
 * @description Full incoming traversal from `file` upward — returns every file whose behaviour
 *   could change if `file` changes (blast-radius analysis). Set `cached=true` to use a pre-computed
 *   O(1) impact cache instead of graph traversal — faster on repeated calls for the same root.
 *   Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `file` is the changed node; `testsOnly` restricts results to test/spec files; `cached` switches to the impact cache; `withMeta` turns each affected path into `{ path, category, exports }`.
 * @returns TextResponse with `{ file, affected, count }` listing all transitively impacted files
 *   (bare paths, or `{ path, category, exports }` objects when `withMeta` is true).
 */
export async function handleGetAffected(
  cache: SessionState,
  args: GetAffectedArgs,
): Promise<TextResponse> {
  const { root, file, testsOnly = false, cached = false, changedSymbols, withMeta = false } = args;
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const annotate = (paths: string[]) =>
    withMeta
      ? withPackageMeta(
          paths.map((p) => ({ path: p, ...getNodeMeta(graph, p) })),
          packageOf,
        )
      : paths;

  if (cached) {
    const impactCache = await cache.getOrBuildChangeImpactForFile(root, file, graph);
    const allAffected = queryChangeImpact(impactCache, file);
    const affected = testsOnly
      ? allAffected.filter((filePath) => graph.nodes.get(filePath)?.category === "test")
      : allAffected;
    const result = annotate(affected);
    return text({ file, affected: result, count: result.length });
  }
  const affected = getAffected(graph, file, { testsOnly, changedSymbols });
  const result = annotate(affected);
  return text({ file, affected: result, count: result.length });
}

/**
 * @description Incoming call-edge traversal — returns files whose exported functions call
 *   into `file`. More precise than `handleGetAffected` because it follows runtime call edges
 *   rather than all import edges.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root`/`file` identify the target; `depth` caps hops; `withEdgeDetail` adds from/to function names per edge.
 * @returns TextResponse with `{ file, callers, count }` where each caller optionally includes edge detail.
 */
export async function handleGetCallers(
  cache: SessionState,
  args: GetCallersArgs,
): Promise<TextResponse> {
  const { root, file, depth = 1, withEdgeDetail = false } = args;
  const { graph, packageOf } = await cache.resolveFlatGraphForFile(root, file);
  const rawCallers = getCallers(graph, file, { depth, withEdgeDetail });
  const callers =
    packageOf.size === 0
      ? rawCallers
      : rawCallers.map((entry) => {
          const pkg = packageOf.get(entry.file);
          return pkg ? { ...entry, package: pkg } : entry;
        });
  const note = callers.length === 0 ? languageSupportNote(graph, "callEdges") : undefined;
  const caveats = callers.length > 0 ? languageCaveats(graph, "callEdges") : [];
  return text({
    file,
    callers,
    count: callers.length,
    ...(note && { note }),
    ...(caveats.length > 0 && { caveats }),
  });
}

/**
 * @description Filters the graph by category, tag, or path substring and returns matching nodes.
 *   On a monorepo root the filter runs once against the flattened whole-workspace graph, so
 *   `sort`/`limit` rank globally and cross-package import edges are retained; each result node
 *   carries its owning `package`, and the `package:` query key (or the `package` arg) narrows to
 *   one. Slim mode (default) strips edge metadata and internal tags for a compact response; pass
 *   `slim: false` for full edge data.
 * @param cache - Session state used to build or retrieve the graph.
 * @param args - `root`/`entryPoints` select the graph; `filter` is the query DSL string; `package` narrows to one workspace package; `mermaid` switches output to a diagram; `slim` controls response verbosity.
 * @returns TextResponse containing either a Mermaid diagram string or a JSON node list with cycle info.
 */
export async function handleQuery(cache: SessionState, args: QueryArgs): Promise<TextResponse> {
  const { root, entryPoints, filter, mermaid = false, slim = true, package: pkg } = args;

  if (entryPoints) {
    const graph = await cache.getOrBuild(
      root,
      entryPoints.map((ep) => path.resolve(root, ep)),
    );
    return textQueryResult(graph, filter, mermaid, slim);
  }

  const { graph, packageOf } = await cache.resolveFlatGraph(root, pkg);
  return textQueryResult(graph, filter, mermaid, slim, packageOf);
}

/** Formats a single-graph query result — shared by `handleQuery`'s entryPoints and
 *  flattened-workspace branches. `packageOf` (empty on a plain root) enables the `package:`
 *  filter key and stamps each result node with its owning package. */
function textQueryResult(
  graph: Graph,
  filter: string,
  mermaid: boolean,
  slim: boolean,
  packageOf: Map<string, string> = new Map(),
): TextResponse {
  const filtered = filterGraph(graph.serialize(), parseQuery(filter), { packageOf });
  if (mermaid) {
    return text(MermaidExporter.serialize(Graph.deserialize(filtered)));
  }
  return text(slim ? slimSerialize(filtered) : filtered);
}

/**
 * @description Looks up callers and callees for a named function. Returns the file that defines
 *   the function, all files/functions that call it, and all files/functions it calls. Call edges
 *   are only populated for TypeScript/JavaScript files. Requires a prior `analyze` call.
 *
 *   When `functionName` is exported by more than one file, `definedInCandidateCount` reports how
 *   many matched; in that ambiguous case `definedIn` is `null` and `callees` is empty unless
 *   `file` narrows the search to one specific defining file (bypassing the ambiguity entirely).
 *   Pass `includeCandidates: true` to see every matching file's path. See
 *   docs/known_issues/13-call-graph-definition-ambiguity.md.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `function` is the exact name of the function to look
 *   up; `file` optionally narrows the definition search to one path; `includeCandidates` opts
 *   into the full candidates list when ambiguous.
 * @returns TextResponse with `{ functionName, definedIn, definedInCandidateCount, callers,
 *   callees, candidates? }`.
 */
export async function handleGetCallGraph(
  cache: SessionState,
  args: GetCallGraphArgs,
): Promise<TextResponse> {
  const { root, function: functionName, package: pkg, file, includeCandidates } = args;
  const { graph } = await cache.resolveFlatGraph(root, pkg);
  const result = queryCallGraph(graph, functionName, {
    ...(file !== undefined && { file }),
    ...(includeCandidates !== undefined && { includeCandidates }),
  });
  const empty = result.callers.length === 0 && result.callees.length === 0;
  const note = empty ? languageSupportNote(graph, "callEdges") : undefined;
  const caveats = empty ? [] : languageCaveats(graph, "callEdges");
  return text({ ...result, ...(note && { note }), ...(caveats.length > 0 && { caveats }) });
}

/**
 * @description Finds every file that exports `name`, with the best available usage info per match
 *   (call-edge callers for TS/JS, named-import tracking for Python, whole-file dependents
 *   otherwise). Requires a prior `analyze` call.
 * @param cache - Session state holding the cached graph for `root`.
 * @param args - `root` selects the graph; `name` is the exact export name to look up.
 * @returns TextResponse with `{ name, matches, count }`.
 */
export async function handleFindSymbol(
  cache: SessionState,
  args: FindSymbolArgs,
): Promise<TextResponse> {
  const { root, name, package: pkg } = args;
  const graphs = await cache.resolveGraphs(root, pkg);
  const multi = graphs.length > 1;
  const matches = graphs.flatMap(({ graph, package: pkgName }) =>
    tagPackage(findSymbol(graph, name), pkgName, multi),
  );
  // Per-match precision already varies (call-edge callers for TS/JS, import tracking for Python,
  // whole-file dependents otherwise); the caveat says which languages can't reach call-level.
  const caveats =
    matches.length > 0
      ? languageCaveats(
          graphs.map(({ graph }) => graph),
          "callEdges",
        )
      : [];
  return text({ name, matches, count: matches.length, ...(caveats.length > 0 && { caveats }) });
}

/**
 * @description Builds the API surface report for a project, expanding `export *` chains so every
 *   symbol accessible to consumers is listed. Partitions the graph into `internalFiles`,
 *   `unreachableFromEntry` (separate consumers or dead-code candidates), and `testFiles`.
 *   `package.json` `bin` targets count as entry points alongside `exports` / `main`.
 *   The single-surface response (plain root, or a single requested `package`) is **summary-first**:
 *   `view:"summary"` (default) returns an {@link ApiSurfaceSummary} — counts, a capped
 *   `{name,kind}` export sample, `byKind`, and the short `unreachableFromEntry` list;
 *   `view:"exports"` adds the full `publicExports`; `view:"full"` returns the complete
 *   {@link ApiSurface} with every path list.
 *   On a monorepo root without `package`: one compact summary per workspace package — per-package
 *   counts only (no path lists), each exported symbol reduced to `{ name, kind }`, and the
 *   `publicExports` sample capped at `maxExportsPerPackage` (default 10; `0` = counts only).
 * @param cache - Session state holding the cached graph(s) for `root`.
 * @param args - `root` selects the project; `entryPoints` overrides auto-detection; `package`
 *   scopes to one workspace package; `view` / `maxExports` shape the single-surface response;
 *   `maxExportsPerPackage` caps the per-package `publicExports` sample in the multi-package
 *   response (default 10, `0` = counts only).
 * @returns TextResponse: an {@link ApiSurfaceSummary} (or fuller, per `view`) for a plain root or
 *   a single requested package; otherwise `{ packages: [...compact per-package summaries],
 *   skipped, truncated }`.
 */
