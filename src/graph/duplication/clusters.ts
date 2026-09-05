/**
 * Groups `DuplicateGroup`s that share the exact same set of files into one `DuplicateCluster`,
 * addressing the "window-splitting" noise class `applyDominanceFilter` (suffix-duplicates.ts)
 * deliberately doesn't touch: two files that share several genuinely non-nested matches (different
 * start positions, no containment relationship — see
 * docs/adr-015-suffix-array-duplicate-detection.md's addendum) still surface as one `DuplicateGroup`
 * per match, so a single real duplication between two files can legitimately report a dozen-plus
 * rows. A file pair matched by 14 separate groups (same two files, non-nested spans) becomes one
 * cluster with `matchCount: 14` instead of 14 rows a caller has to manually recognize as "the same
 * underlying duplication" — the `ContentExplorer.tsx`/`ContentPicker.js` case from the dogfooding
 * report this responds to.
 *
 * **This module previously clustered by connected file-component (union-find: any two files that
 * co-occur in some group's occurrences are connected, transitively) instead of exact file-set
 * equality, and that was wrong — caught by a follow-up dogfood pass before anyone relied on it.**
 * Connected-component clustering is single-linkage clustering, and single-linkage is notorious for
 * "chaining": on a real repo, one file sharing a single incidental block each with dozens of
 * otherwise-unrelated files is enough to transitively merge all of them into one cluster, since
 * connectivity only ever needs one bridge edge, never a strong one. Confirmed in practice on a
 * production monorepo: 803 files and 4,853 groups collapsed into a single "cluster" — a regression,
 * not a summary, and strictly less useful than the flat `groups` list it was meant to compress.
 * Exact file-set equality can't chain this way: a group between `{A, B}` and a group between
 * `{B, C}` (B is a genuine bridge — it duplicates code with both, but that doesn't mean A and C
 * relate to each other) land in two separate clusters, not one, because their occurrence sets
 * differ. The trade-off this accepts: a true N-way clone family reported as several exact-N-way
 * groups already merges correctly (same set every time); one reported as several *different-sized*
 * subsets (a 3-file match here, a 2-file subset of it there) does not merge into one cluster. That
 * residual case is deliberately left alone rather than resolved with more graph theory — a
 * conservative under-merge is a far safer default than the chaining failure mode above.
 *
 * **Coverage.** `matchCount: 14` still reads as "14 things," not "one relationship" — the same
 * gap SonarQube's duplication check closes by reporting a merged duplication-*density* percentage
 * per file instead of an enumerated match list. {@link DuplicateCluster.coverage} does the same
 * here: union each cluster's occurrence spans per file (so overlapping/adjacent sub-matches count
 * once, not once each) and divide by that file's total line count — turning
 * `matchCount: 14, files: ["ContentExplorer.tsx", "ContentPicker.js"]` into
 * `"ContentExplorer.tsx: 62% (312/501 lines) duplicated with ContentPicker.js"`, which is a much
 * more decisive triage signal than the match count alone: high coverage on both sides says "these
 * are near-duplicate files," low coverage says "one shared helper embedded in two otherwise-
 * unrelated files."
 */
import type { DuplicateGroup } from "./shingle";

export interface DuplicateClusterFileCoverage {
  file: string;
  /** Total lines this cluster's occurrences cover in `file`, after merging overlapping/adjacent
   *  spans across every group in the cluster — never double-counts a line two groups both touch. */
  coveredLines: number;
  /** `file`'s total line count, when known (the caller passed `fileLineCounts` and had an entry
   *  for it) — `undefined` otherwise, e.g. a cache-hit file scanned without re-reading its source. */
  totalLines: number | undefined;
  /** `coveredLines / totalLines * 100`, rounded to one decimal place — `undefined` when
   *  `totalLines` isn't known or is 0. */
  coveragePct: number | undefined;
}

export interface DuplicateCluster {
  /** The exact set of files every group in this cluster shares occurrences in, sorted. */
  files: string[];
  /** This cluster's member groups, largest-`lines`-first — the same `DuplicateGroup` objects
   *  `findDuplicates` would otherwise report standalone, unmodified. */
  groups: DuplicateGroup[];
  /** `groups.length` — how many separate matches this cluster bundles. A cluster with
   *  `matchCount: 1` is just a single group reported through the same shape for consistency. */
  matchCount: number;
  /** The largest `lines` value across this cluster's groups — the single best-verified size for
   *  "how big is this duplication," independent of how many rows it fragmented into. */
  longestMatch: number;
  /** Per-file duplication coverage, same order as `files` — see this module's top-of-file
   *  comment. Every entry has `coveredLines`; `totalLines`/`coveragePct` are only present when
   *  `buildDuplicateClusters` was given a line count for that file. */
  coverage: DuplicateClusterFileCoverage[];
}

interface LineSpan {
  start: number;
  end: number;
}

/**
 * @description Merges overlapping or touching line spans into their minimal covering set, so a
 *   file covered by several of a cluster's groups (possibly overlapping, e.g. a longer match and
 *   a shorter one nested inside it) counts its shared lines once, not once per group.
 * @param spans - Every occurrence span for one file across a cluster's groups, any order.
 * @returns Non-overlapping spans, sorted by start line.
 */
function mergeLineSpans(spans: readonly LineSpan[]): LineSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: LineSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end + 1) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * @description Computes one file's duplication coverage within a cluster: merges that file's
 *   occurrence spans across every group in the cluster, sums the covered lines, and divides by the
 *   file's total line count when known.
 * @param file - The file to compute coverage for.
 * @param clusterGroups - Every group in this file's cluster.
 * @param fileLineCounts - Total line counts by file path, when the caller has them.
 * @returns This file's {@link DuplicateClusterFileCoverage}.
 */
function computeFileCoverage(
  file: string,
  clusterGroups: readonly DuplicateGroup[],
  fileLineCounts: ReadonlyMap<string, number> | undefined,
): DuplicateClusterFileCoverage {
  const spans = clusterGroups
    .flatMap((group) => group.occurrences)
    .filter((occ) => occ.file === file)
    .map((occ) => ({ start: occ.startLine, end: occ.endLine }));
  const coveredLines = mergeLineSpans(spans).reduce(
    (sum, span) => sum + (span.end - span.start + 1),
    0,
  );
  const totalLines = fileLineCounts?.get(file);
  const coveragePct =
    totalLines !== undefined && totalLines > 0
      ? Math.round((coveredLines / totalLines) * 1000) / 10
      : undefined;
  return { file, coveredLines, totalLines, coveragePct };
}

/**
 * @description Buckets every group in `groups` by its occurrences' exact file set (order-
 *   independent, duplicates within one group's occurrences collapsed) — deliberately *not*
 *   transitive: a group over `{A, B}` and a group over `{B, C}` are different keys and land in
 *   different clusters even though they share file B, so one file that happens to duplicate code
 *   with many unrelated others can never chain them all into one cluster (see this module's
 *   top-of-file doc comment for why that matters).
 * @param groups - Every group to cluster — call with the full pre-`limit` set (not an
 *   already-truncated slice) so a cluster's `matchCount` isn't artificially shrunk by an unrelated
 *   cap applied earlier.
 * @param fileLineCounts - Total line counts by file path, when available (`findDuplicates` passes
 *   what it already knows from having read each file). Powers `coverage[].totalLines`/
 *   `coveragePct` — omit to still get `coverage[].coveredLines` with `totalLines`/`coveragePct`
 *   left `undefined`.
 * @returns Clusters, largest-`longestMatch`-first (ties broken by `matchCount` descending) — not
 *   itself limited; callers slice as needed the same way they already slice `groups`.
 */
export function buildDuplicateClusters(
  groups: readonly DuplicateGroup[],
  fileLineCounts?: ReadonlyMap<string, number>,
): DuplicateCluster[] {
  const groupsByFileSetKey = new Map<string, { files: string[]; groups: DuplicateGroup[] }>();

  for (const group of groups) {
    const files = [...new Set(group.occurrences.map((occ) => occ.file))].sort();
    const key = files.join(" ");
    const bucket = groupsByFileSetKey.get(key);
    if (bucket) bucket.groups.push(group);
    else groupsByFileSetKey.set(key, { files, groups: [group] });
  }

  const clusters: DuplicateCluster[] = [];
  for (const { files, groups: clusterGroups } of groupsByFileSetKey.values()) {
    const longestMatch = Math.max(...clusterGroups.map((group) => group.lines));
    clusters.push({
      files,
      groups: [...clusterGroups].sort((a, b) => b.lines - a.lines),
      matchCount: clusterGroups.length,
      longestMatch,
      coverage: files.map((file) => computeFileCoverage(file, clusterGroups, fileLineCounts)),
    });
  }

  return clusters.sort((a, b) => b.longestMatch - a.longestMatch || b.matchCount - a.matchCount);
}
