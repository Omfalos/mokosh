/**
 * Exact cross-file duplicate detection via suffix array + LCP-interval tree, replacing
 * `shingle.ts`'s hash-shingle-bucket matcher as `findDuplicates`' matching engine — see
 * docs/adr-015-suffix-array-duplicate-detection.md for why. `shingle.ts` itself is untouched and
 * still independently tested; this module supersedes it in the actual pipeline only.
 *
 * All of `files`' token streams (already comment-stripped/normalized by `tokenize()`) are
 * concatenated into one stream, with a unique-per-file sentinel token between files so no match
 * can span a file boundary. A single suffix array + LCP array + LCP-interval-tree pass over that
 * whole stream finds every maximal repeated token run across every file at once — O(n log n) /
 * O(n), with the interval count itself bounded by the stream length regardless of how repetitive
 * it is. No bucket-size cap is needed (there is nothing resembling a hash bucket to blow up), and
 * every reported match length is exact — no chain-extension lookahead, no truncation.
 */

import { buildLcpIntervals, type LcpInterval } from "./lcp-intervals";
import {
  type DuplicateGroup,
  type DuplicateOccurrence,
  type FileTokens,
  structuralPunctuationRatio,
} from "./shingle";
import { buildLcpArray, buildSuffixArray } from "./suffix-array";
import type { NormalizedToken } from "./tokenizer";

export type { FileTokens } from "./shingle";

/** Where one position in the concatenated token stream came from. A sentinel position (inserted
 *  once after each file's real tokens) carries `localIndex: -1` — it's part of the alphabet so
 *  suffix sorting works, but never a valid match *start*. */
interface SourcePosition {
  file: string;
  localIndex: number;
}

/**
 * @description Finds every maximal duplicated token run of at least `windowSize` tokens across
 *   `files`, via suffix array + LCP-interval enumeration instead of hash-shingle-bucket pairwise
 *   comparison.
 * @param files - Per-file normalized token streams (already comment-stripped and identifier/
 *   literal-normalized by `tokenize`).
 * @param windowSize - Minimum shared token-run length to report — the smallest duplicate this
 *   can find (same role as `shingle.ts`'s shingle window size, but here it's an exact threshold
 *   on the LCP-interval's `lcpLength`, not a hash-window size).
 * @param minLines - Minimum merged block size (in source lines, taken as the minimum across all
 *   of a group's occurrences) to report.
 * @param maxPunctuationRatio - Maximum fraction of a candidate block's tokens that may be
 *   object/array-literal structural punctuation (default 0.5) — see
 *   {@link structuralPunctuationRatio}. Checked against the block's first surviving occurrence.
 *   Set to 1 to disable.
 * @returns Duplicate blocks, each with two or more occurrences (same-file self-overlapping
 *   occurrences collapsed via a greedy non-overlap scan, exactly as `shingle.ts` excludes
 *   same-file self-overlap), sorted largest-first.
 */
export function findExactDuplicateGroups(
  files: FileTokens[],
  windowSize: number,
  minLines: number,
  maxPunctuationRatio = 0.5,
): DuplicateGroup[] {
  const tokenTexts: string[] = [];
  const positions: SourcePosition[] = [];
  const tokensByFile = new Map<string, NormalizedToken[]>();

  for (const { file, tokens } of files) {
    if (tokens.length === 0) continue;
    tokensByFile.set(file, tokens);
    for (let i = 0; i < tokens.length; i++) {
      tokenTexts.push((tokens[i] as NormalizedToken).text);
      positions.push({ file, localIndex: i });
    }
    // Unique per file (the file's own project-relative path can't collide with another
    // file's) and can't collide with any real token text: tokenize()'s TOKEN_PATTERN never
    // matches starting on whitespace, so no real token text begins with a literal space, but
    // this sentinel always does. Guarantees no match can span two files -- comparing across
    // a sentinel always fails immediately, since no two files share one and no real token
    // equals one.
    tokenTexts.push(` ${file}`);
    positions.push({ file, localIndex: -1 });
  }

  if (tokenTexts.length === 0) return [];

  const sa = buildSuffixArray(tokenTexts);
  const lcp = buildLcpArray(tokenTexts, sa);
  const intervals = buildLcpIntervals(lcp);

  const groups: DuplicateGroup[] = [];
  for (const interval of intervals) {
    const group = groupFromInterval(
      interval,
      sa,
      positions,
      tokensByFile,
      windowSize,
      minLines,
      maxPunctuationRatio,
    );
    if (group) groups.push(group);
  }

  return groups.sort((groupA, groupB) => groupB.lines - groupA.lines);
}

/**
 * @description Converts one LCP interval into a `DuplicateGroup`, or `undefined` if it fails any
 *   of the checks that disqualify a candidate: below `windowSize`, fewer than two real
 *   occurrences, not left-maximal (see {@link isLeftMaximal}), fewer than two occurrences left
 *   after same-file self-overlap exclusion, too punctuation-dense, or shorter than `minLines`.
 *   Factored out of {@link findExactDuplicateGroups}'s main loop specifically to keep each check
 *   an early return in its own stack frame rather than an accumulating `continue` chain — same
 *   logic, lower nesting.
 * @param interval - One candidate from {@link buildLcpIntervals}.
 * @param sa - The suffix array `interval.low`/`interval.high` index into.
 * @param positions - Source position for every entry in `sa`.
 * @param tokensByFile - Token streams, for reading lines and punctuation density.
 * @param windowSize - Minimum shared token-run length to report.
 * @param minLines - Minimum merged block size (in source lines) to report.
 * @param maxPunctuationRatio - Maximum structural-punctuation fraction to allow.
 * @returns The `DuplicateGroup` for this interval, or `undefined` if disqualified.
 */
function groupFromInterval(
  interval: LcpInterval,
  sa: readonly number[],
  positions: readonly SourcePosition[],
  tokensByFile: ReadonlyMap<string, NormalizedToken[]>,
  windowSize: number,
  minLines: number,
  maxPunctuationRatio: number,
): DuplicateGroup | undefined {
  if (interval.lcpLength < windowSize) return undefined;

  const rawOccurrences: SourcePosition[] = [];
  for (let i = interval.low; i <= interval.high; i++) {
    const pos = positions[sa[i] as number] as SourcePosition;
    if (pos.localIndex !== -1) rawOccurrences.push(pos);
  }
  if (rawOccurrences.length < 2) return undefined;
  if (!isLeftMaximal(rawOccurrences, tokensByFile)) return undefined;

  const kept = dropSelfOverlaps(rawOccurrences, interval.lcpLength);
  if (kept.length < 2) return undefined;

  const first = kept[0] as SourcePosition;
  const firstTokens = tokensByFile.get(first.file) as NormalizedToken[];
  if (
    structuralPunctuationRatio(firstTokens, first.localIndex, interval.lcpLength) >
    maxPunctuationRatio
  ) {
    return undefined;
  }

  const occurrences: DuplicateOccurrence[] = kept.map(({ file, localIndex }) => {
    const tokens = tokensByFile.get(file) as NormalizedToken[];
    return {
      file,
      startLine: (tokens[localIndex] as NormalizedToken).line,
      endLine: (tokens[localIndex + interval.lcpLength - 1] as NormalizedToken).line,
    };
  });

  const lines = Math.min(
    ...occurrences.map((occurrence) => occurrence.endLine - occurrence.startLine + 1),
  );
  if (lines < minLines) return undefined;

  return { occurrences, lines, tokens: interval.lcpLength };
}

/**
 * @description Whether an interval's occurrence set is a genuine ("left-maximal", in stringology
 *   terms) repeat rather than a redundant truncation of one. Every suffix of a real duplicated
 *   block independently satisfies right-maximality (an LCP interval's `lcpLength` is, by
 *   construction, the longest shared prefix for its exact membership) — so without this check, a
 *   single 15-token duplicate would also surface as separate, fully-redundant 14-, 13-, ...-token
 *   "duplicates" starting one position later each, since every one of those shorter runs is,
 *   trivially, also shared by the same two locations. An interval is left-maximal exactly when
 *   its occurrences do *not* all share the same immediately-preceding token — if they did, the
 *   match could be extended one token to the left for every occurrence at once, meaning a longer,
 *   equally-valid interval already covers this same finding (and will itself pass this same
 *   check, or be excluded by the same logic one level up, recursively) — including the case where
 *   every occurrence has no preceding token at all (starts at its file's position 0), which is
 *   vacuously left-maximal.
 * @param occurrences - An interval's real (non-sentinel) occurrences, at least 2.
 * @param tokensByFile - Token streams, for reading each occurrence's preceding token.
 * @returns `false` only when every occurrence has a preceding token and they're all identical.
 */
function isLeftMaximal(
  occurrences: readonly SourcePosition[],
  tokensByFile: ReadonlyMap<string, NormalizedToken[]>,
): boolean {
  let precedingText: string | null = null;
  for (const { file, localIndex } of occurrences) {
    if (localIndex === 0) return true;
    const tokens = tokensByFile.get(file) as NormalizedToken[];
    const preceding = (tokens[localIndex - 1] as NormalizedToken).text;
    if (precedingText === null) precedingText = preceding;
    else if (precedingText !== preceding) return true;
  }
  return false;
}

/**
 * @description Drops same-file occurrences whose `[localIndex, localIndex + length)` span
 *   overlaps an already-kept occurrence in that same file — a match against itself at an
 *   overlapping offset isn't a real duplicate (it's the same span, not a copy of it), mirroring
 *   `shingle.ts`'s same-file self-overlap exclusion. A greedy sorted-position scan (`O(m log m)`)
 *   rather than pairwise comparison, so even a pathologically common token pattern's interval
 *   (large `m`) stays cheap to filter — unlike the hash-bucket matcher this replaces, nothing
 *   here is quadratic in interval size.
 * @param occurrences - Every non-sentinel occurrence in one LCP interval.
 * @param length - The interval's shared token-run length (every occurrence's span is this long).
 * @returns Non-overlapping occurrences, cross-file occurrences always kept.
 */
function dropSelfOverlaps(occurrences: SourcePosition[], length: number): SourcePosition[] {
  const byFile = new Map<string, number[]>();
  for (const { file, localIndex } of occurrences) {
    const starts = byFile.get(file);
    if (starts) starts.push(localIndex);
    else byFile.set(file, [localIndex]);
  }

  const kept: SourcePosition[] = [];
  for (const [file, starts] of byFile) {
    starts.sort((a, b) => a - b);
    let lastEnd = Number.NEGATIVE_INFINITY;
    for (const start of starts) {
      if (start >= lastEnd) {
        kept.push({ file, localIndex: start });
        lastEnd = start + length;
      }
    }
  }
  return kept;
}
