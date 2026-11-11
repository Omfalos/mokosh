import {
  DEFAULT_IGNORE_DIRS,
  type DuplicateQuery,
  type DuplicatesSummary,
  type DuplicationResultParams,
  dedupeGroupsAgainstClusters,
  duplicationDigest,
  duplicationResultCacheKey,
  findDuplicates,
  languageCaveats,
  loadDuplicationResult,
  parseDupQuery,
  resolveDuplicationFlags,
  saveDuplicationResult,
  slimDupCluster,
  slimDupGroup,
  sortLimitDupGroups,
  summarizeDuplicates,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import { tagPackage } from "./fanout";
import type { FindDuplicatesArgs } from "./types";

/** Floor for how many duplicate matches `find_duplicates` keeps per package before the
 *  cross-package global sort (used when it exceeds `limit * 4`). Bounds per-package retention
 *  without truncating so aggressively that the global ranking loses real top hits. */
const FIND_DUPLICATES_PER_PACKAGE_CAP = 500;

/** Byte ceiling for the serialized `find_duplicates` response (~30K tokens). Past this the
 *  group/cluster lists are halved until the payload fits and the result is flagged `truncated`.
 *  A hard backstop only — the response is summary-first and low-limit by default, so this
 *  rarely engages. */
const FIND_DUPLICATES_MAX_PAYLOAD_BYTES = 120_000;

/** Cluster count in the default (no `filter`, no `view`) `find_duplicates` response — a fixed,
 *  cheap triage ceiling independent of repo size. Narrow with `filter` for more. */
const FIND_DUPLICATES_PREVIEW_LIMIT = 8;

/** The one-line drill-in nudge carried on a default (summary) `find_duplicates` response —
 *  turns the `summary` counts into concrete next-call suggestions so the `filter` / `view` path
 *  actually gets used instead of the caller re-requesting the whole list. */
function buildDuplicatesHint(summary: DuplicatesSummary): string {
  const dirCount = Object.keys(summary.byTopDir).length;
  const families = Object.keys(summary.byFamily).filter((family) => family !== "other");
  const familyEg = families.length > 1 ? ` or filter:"family:${families[0]},sort:score"` : "";
  return (
    `${summary.matched} duplicate group${summary.matched === 1 ? "" : "s"} across ` +
    `${dirCount} ${dirCount === 1 ? "dir" : "dirs"}; showing the top clusters. ` +
    `Narrow with filter, e.g. filter:"path:src,minScore:15"${familyEg}. ` +
    `Pass view:"groups" for raw spans or view:"full" for both lists.`
  );
}

type DupScan = Awaited<ReturnType<typeof findDuplicates>>;
type PackageScan = { groups: DupScan["groups"]; clusters: DupScan["clusters"] };
type MokoshConfigView = ReturnType<SessionState["getConfig"]>;

/** Every output-affecting scan knob, resolved once (args > config > default) — both the scan call
 *  and the result-cache key read from this, so they can never drift. */
type ResolvedScanParams = {
  minLines: number;
  ignoreLiterals: boolean;
  maxPunctuationRatio: number;
  ignoreDirs: string[];
  includeGenerated: boolean;
  includeSameFile: boolean;
  includeSvgMarkup: boolean;
  includeDocs: boolean;
  scope: FindDuplicatesArgs["scope"];
  ignoreGlobs: string[];
};

/**
 * @description Resolves scan parameters from tool args, falling back to the root's config.
 * @param args - The tool args.
 * @param config - The root's loaded config, if `analyze` stored one.
 * @returns The fully-resolved scan parameters.
 */
function resolveScanParams(args: FindDuplicatesArgs, config: MokoshConfigView): ResolvedScanParams {
  return {
    minLines: args.minLines ?? 6,
    ignoreLiterals: args.ignoreLiterals ?? true,
    maxPunctuationRatio: args.maxPunctuationRatio ?? 0.5,
    ignoreDirs: args.ignoreDirs ?? [...DEFAULT_IGNORE_DIRS, ...(config?.ignoreDirs ?? [])],
    ...resolveDuplicationFlags(args, config),
  };
}

/**
 * @description Scans each package graph sequentially (never `Promise.all`: each `findDuplicates`
 *   call spins up its own tokenizing worker pool and a suffix array per language family, so N
 *   concurrent scans on a large monorepo exhaust the heap), serving an unfiltered scan from the
 *   digest-checked result cache when possible.
 * @param cache - Session state (graphs, token cache, cache paths).
 * @param root - Project root.
 * @param graphs - Per-package graphs from `cache.resolveGraphs`.
 * @param params - Resolved scan parameters.
 * @param perPackageCap - Retention cap per package — above the response limit so the cross-package
 *   sort and the cached "full" result stay accurate, but finite.
 * @param filter - Optional filter DSL; its presence disables the result cache.
 * @returns One `{ groups, clusters }` per package, tagged with `package` on a monorepo.
 */
async function scanPackages(
  cache: SessionState,
  root: string,
  graphs: Awaited<ReturnType<SessionState["resolveGraphs"]>>,
  params: ResolvedScanParams,
  perPackageCap: number,
  filter: string | undefined,
): Promise<PackageScan[]> {
  const multi = graphs.length > 1;
  const resultParams: DuplicationResultParams = { ...params, limit: perPackageCap };
  const paramsKey = duplicationResultCacheKey(resultParams);
  // The result cache only holds an unfiltered scan — a `filter` run always re-scans (predicate
  // keys are applied inside `findDuplicates`, pre-clustering).
  const useResultCache = filter === undefined;

  const tokenCache = await cache.getDuplicationTokenCache(root);
  const perPackage: PackageScan[] = [];
  let didScan = false;
  for (const { graph, package: pkgName } of graphs) {
    const resultCachePath = cache.duplicationResultCachePath(root, multi ? pkgName : undefined);
    const digest = useResultCache ? duplicationDigest(graph.nodes.values()) : "";
    const cached = useResultCache
      ? loadDuplicationResult(resultCachePath, digest, paramsKey)
      : null;
    if (cached) {
      perPackage.push({
        groups: tagPackage(cached.groups, pkgName, multi),
        clusters: tagPackage(cached.clusters, pkgName, multi),
      });
      continue;
    }
    didScan = true;
    const { groups, clusters } = await findDuplicates(graph, root, {
      ...params,
      limit: perPackageCap,
      // Predicate keys only — the DSL's sort/limit are applied after the per-package merge.
      ...(filter !== undefined && { filter }),
      tokenCache,
    });
    if (useResultCache) {
      saveDuplicationResult(resultCachePath, digest, paramsKey, groups, clusters);
    }
    perPackage.push({
      groups: tagPackage(groups, pkgName, multi),
      clusters: tagPackage(clusters, pkgName, multi),
    });
  }
  if (didScan) cache.flushDuplicationTokenCache(root);
  return perPackage;
}

/**
 * @description Halves the group/cluster lists until the serialized payload fits under
 *   {@link FIND_DUPLICATES_MAX_PAYLOAD_BYTES}, measuring the shape actually emitted.
 * @param groups - Candidate group list.
 * @param clusters - Candidate cluster list.
 * @param slim - Whether items are compacted before serialization.
 * @param probe - The non-list parts of the payload (`minLines`, `summary`), for size measurement.
 * @returns The (possibly trimmed) lists and whether trimming happened.
 */
function fitPayload(
  groups: DupScan["groups"],
  clusters: DupScan["clusters"],
  slim: boolean,
  probe: Record<string, unknown>,
): { groups: DupScan["groups"]; clusters: DupScan["clusters"]; truncated: boolean } {
  const shapeGroups = (g: DupScan["groups"]) => (slim ? g.map(slimDupGroup) : g);
  const shapeClusters = (c: DupScan["clusters"]) => (slim ? c.map(slimDupCluster) : c);
  let truncated = false;
  while (
    (groups.length > 1 || clusters.length > 1) &&
    JSON.stringify({ ...probe, groups: shapeGroups(groups), clusters: shapeClusters(clusters) })
      .length > FIND_DUPLICATES_MAX_PAYLOAD_BYTES
  ) {
    groups = groups.slice(0, Math.max(1, Math.floor(groups.length / 2)));
    clusters = clusters.slice(0, Math.max(1, Math.floor(clusters.length / 2)));
    truncated = true;
  }
  return { groups, clusters, truncated };
}

/**
 * @description Scans every file in the graph for cross-file (and within-file) duplicated code.
 *   Token-based rather than AST-based, so it covers every language mokosh parses. Matching runs
 *   on a suffix array over the whole candidate token stream
 *   (docs/adr-015-suffix-array-duplicate-detection.md) — exact and complete regardless of how
 *   repetitive the repo is.
 *
 *   **Summary-first response.** With no `filter` and no `view` the response is just `summary` +
 *   a small `clusters` preview (`FIND_DUPLICATES_PREVIEW_LIMIT`) + a `hint` — no `groups`, since
 *   every group in a multi-member cluster is redundant with it. Pass a `filter` for `summary` +
 *   matching `clusters`; `view: "groups"` for the raw per-span `groups`; `view: "full"` for both
 *   (with `groups` de-duped against the returned clusters). Each slim cluster carries
 *   `longestMatchAt` — the `"path:start-end"` span of its biggest match — so it is actionable
 *   without the `groups` list.
 *
 *   **Result cache.** When no `filter` is given, the full pre-`limit` `{ groups, clusters }` is
 *   read from / written to `mokosh-cache/duplication-result.json` (per package on a monorepo),
 *   keyed by a digest of every graph node's mtime/size plus the output-affecting scan params
 *   (`src/graph/duplication/result-cache-store.ts`). An unchanged repo skips the scan entirely;
 *   any file edit, add, remove, or param change forces a recompute. A `filter` run always
 *   scans (it is the explicit drill-in path).
 * @param cache - Session state holding the cached graph and, if `analyze` set one, this root's
 *   config (read for `ignoreDirs` / `duplication.*`).
 * @param args - `root` selects the graph; `minLines` (default 6), `ignoreLiterals` (default
 *   true), `maxPunctuationRatio` (default 0.5), `ignoreDirs`, `includeGenerated`,
 *   `includeSameFile`, `includeSvgMarkup`, `includeDocs`, `scope` tune the scan; `filter` is the
 *   `key:value` DSL (`src/query/dup-parser.ts`); `view` (`"summary"` default | `"groups"` |
 *   `"full"`) picks which lists come back; `slim` (default true) compacts each item; `limit`
 *   caps the non-preview lists (default 20).
 * @returns TextResponse with `{ minLines, filter?, summary, clusters?, groups?, count?, hint?,
 *   truncated? }`. `summary` (`{ matched, byFamily, byTopDir, bySignal, largestLines,
 *   clusteredGroups? }`) is the whole post-`filter`, pre-`limit` view.
 */
export async function handleFindDuplicates(
  cache: SessionState,
  args: FindDuplicatesArgs,
): Promise<TextResponse> {
  const { root, limit = 20, filter, slim = true, package: pkg } = args;
  // Parse the filter DSL up front so a malformed string fails before the (expensive) scan.
  const dupQuery: DuplicateQuery | undefined = filter ? parseDupQuery(filter) : undefined;
  const effectiveLimit = dupQuery?.limit ?? limit;

  const graphs = await cache.resolveGraphs(root, pkg);
  const params = resolveScanParams(args, cache.getConfig(root));
  const perPackageCap =
    graphs.length > 1 || dupQuery
      ? Math.max(effectiveLimit * 4, FIND_DUPLICATES_PER_PACKAGE_CAP)
      : Math.max(effectiveLimit, FIND_DUPLICATES_PER_PACKAGE_CAP);
  const perPackage = await scanPackages(cache, root, graphs, params, perPackageCap, filter);

  const mergedGroups = perPackage.flatMap((result) => result.groups);
  // Summary is computed from the full merged, post-`filter`, pre-`limit` set — a lower bound on a
  // huge monorepo where the per-package cap clipped, exact otherwise.
  const summary = summarizeDuplicates(mergedGroups);

  // DSL `sort` (lines | score | occurrences, asc/desc) when given; otherwise the historical
  // largest-`lines`-first order.
  const orderedGroups = dupQuery?.sort
    ? sortLimitDupGroups(mergedGroups, dupQuery)
    : [...mergedGroups].sort((a, b) => b.lines - a.lines);
  const orderedClusters = perPackage
    .flatMap((result) => result.clusters)
    .sort((a, b) => b.longestMatch - a.longestMatch || b.matchCount - a.matchCount);

  const view = args.view ?? "summary";
  // The bare default: no `filter`, no explicit `view`. Only this shape gets the cluster preview
  // cap and the `hint`.
  const bareDefault = filter === undefined && args.view === undefined;
  const wantGroups = view === "groups" || view === "full";
  const wantClusters = view !== "groups";

  const clusterCap = bareDefault ? FIND_DUPLICATES_PREVIEW_LIMIT : effectiveLimit;
  const selectedClusters = wantClusters ? orderedClusters.slice(0, clusterCap) : [];

  let selectedGroups: typeof orderedGroups = [];
  let clusteredGroups: number | undefined;
  if (wantGroups) {
    if (view === "full") {
      // The only path returning both lists — drop groups already covered by a returned
      // multi-member cluster so the two lists don't restate each other.
      const deduped = dedupeGroupsAgainstClusters(orderedGroups, selectedClusters);
      clusteredGroups = orderedGroups.length - deduped.length;
      selectedGroups = deduped.slice(0, effectiveLimit);
    } else {
      selectedGroups = orderedGroups.slice(0, effectiveLimit);
    }
  }
  const responseSummary: DuplicatesSummary =
    clusteredGroups !== undefined ? { ...summary, clusteredGroups } : summary;

  const { groups, clusters, truncated } = fitPayload(selectedGroups, selectedClusters, slim, {
    minLines: params.minLines,
    summary: responseSummary,
  });

  // `duplication` fidelity is `partial` for every non-CSS language (the generic token pipeline),
  // so `languageCaveats` stays quiet there unless a language carries a concrete note (e.g. Stylus:
  // no shared PostCSS AST).
  const caveats = languageCaveats(
    graphs.map(({ graph }) => graph),
    "duplication",
  );

  return text({
    minLines: params.minLines,
    ...(filter !== undefined && { filter }),
    summary: responseSummary,
    ...(wantClusters && { clusters: slim ? clusters.map(slimDupCluster) : clusters }),
    ...(wantGroups && { groups: slim ? groups.map(slimDupGroup) : groups, count: groups.length }),
    ...(bareDefault && { hint: buildDuplicatesHint(summary) }),
    ...(caveats.length > 0 && { caveats }),
    ...(truncated && { truncated }),
  });
}
