/**
 * Response-shaping helpers shared by the `find_duplicates` MCP handler and the `--find-duplicates`
 * CLI command: a triage-first `summary` block and the compact ("slim") group/cluster projections.
 * Kept separate from `index.ts` (the scan) and `dup-filter.ts` (the predicate) so both consumers
 * present duplicate results identically.
 */
import type { DuplicateCluster } from "./clusters";
import type { DuplicateGroup } from "./shingle";

/** First path segment of a project-relative path (`"packages/app/x.ts"` -> `"packages"`), or
 *  `"."` when the file sits at the repo root — the bucket key for `summary.byTopDir`. */
export function topDir(relPath: string): string {
  const slash = relPath.indexOf("/");
  return slash === -1 ? "." : relPath.slice(0, slash);
}

/** Tallies `values` into a `{ value: count }` record, insertion-ordered. */
function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/** The triage-first `summary` block. */
export interface DuplicatesSummary {
  /** How many groups matched (post-`filter`, before any response `limit`). A lower bound when a
   *  per-package scan cap clipped on a very large monorepo; exact otherwise. */
  matched: number;
  /** Group count per language `family`. */
  byFamily: Record<string, number>;
  /** Group count per top-level directory — a group touching two dirs counts in both. */
  byTopDir: Record<string, number>;
  /** Occurrence-signal frequency across the matched groups. */
  bySignal: Record<string, number>;
  /** Largest `lines` value among the matched groups. */
  largestLines: number;
}

/**
 * @description Builds the {@link DuplicatesSummary} for a `find_duplicates` response — the counts
 *   a caller reads once to decide which targeted `filter` call to make next, without pulling the
 *   full group list.
 * @param {readonly DuplicateGroup[]} groups - Every group that survived the `filter` predicate,
 *   before the response `limit` truncates the list.
 * @returns {DuplicatesSummary} The aggregate counts.
 */
export function summarizeDuplicates(groups: readonly DuplicateGroup[]): DuplicatesSummary {
  const dirCounts: Record<string, number> = {};
  const signalList: string[] = [];
  let largestLines = 0;
  for (const group of groups) {
    if (group.lines > largestLines) largestLines = group.lines;
    for (const signal of group.signals ?? []) signalList.push(signal);
    for (const dir of new Set(group.occurrences.map((occ) => topDir(occ.file)))) {
      dirCounts[dir] = (dirCounts[dir] ?? 0) + 1;
    }
  }
  return {
    matched: groups.length,
    byFamily: tally(groups.map((group) => group.family ?? "other")),
    byTopDir: dirCounts,
    bySignal: tally(signalList),
    largestLines,
  };
}

/** Compact `["path:startLine-endLine", …]` rendering of a group's occurrences. */
export function slimOccurrences(group: DuplicateGroup): string[] {
  return group.occurrences.map((occ) => `${occ.file}:${occ.startLine}-${occ.endLine}`);
}

/**
 * @description Slim per-group projection: size / score / classification / signals plus
 *   `"path:start-end"` occurrence strings — no duplicated source text, no per-occurrence
 *   metadata objects. Preserves a `package` field when `findDuplicates`' caller tagged one.
 * @param {DuplicateGroup} group - A finalized duplicate group.
 * @returns {Record<string, unknown>} The compact object.
 */
export function slimDupGroup(group: DuplicateGroup): Record<string, unknown> {
  const pkg = (group as { package?: string }).package;
  return {
    lines: group.lines,
    ...(group.score !== undefined && { score: group.score }),
    ...(group.family !== undefined && { family: group.family }),
    ...(group.kind !== undefined && { kind: group.kind }),
    ...(group.defKind !== undefined && { defKind: group.defKind }),
    ...(group.signals !== undefined && { signals: group.signals }),
    ...(pkg !== undefined && { package: pkg }),
    occurrences: slimOccurrences(group),
  };
}

/**
 * @description Slim per-cluster projection: the file set, match count, best-verified size and
 *   per-file coverage — without the nested member-group bodies.
 * @param {DuplicateCluster} cluster - A built cluster.
 * @returns {Record<string, unknown>} The compact object.
 */
export function slimDupCluster(cluster: DuplicateCluster): Record<string, unknown> {
  const pkg = (cluster as { package?: string }).package;
  return {
    files: cluster.files,
    matchCount: cluster.matchCount,
    longestMatch: cluster.longestMatch,
    coverage: cluster.coverage,
    ...(pkg !== undefined && { package: pkg }),
  };
}
