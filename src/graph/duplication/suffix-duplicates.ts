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
 *
 * A shared boilerplate shape produces a *family* of tree nodes, not one: a shorter interval with
 * more occurrences (the shared prefix every copy has), and one or more longer sibling intervals
 * with fewer occurrences each (the subsets that extend that prefix further). Every node is
 * individually a valid maximal repeat, but reporting the whole family as separate groups is
 * exactly the "same shape, one row per variant" noise dogfooding surfaced (see
 * docs/known_issues/09-duplicate-clone-family-noise.md). `applyDominanceFilter` below
 * consolidates that family into its most-specific members — see its doc comment for the
 * containment argument.
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
 *   same-file self-overlap; occurrences subsumed by a longer match elsewhere are dropped too, see
 *   {@link applyDominanceFilter}), sorted largest-first.
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

  const candidates: Candidate[] = [];
  for (const interval of intervals) {
    const candidate = candidateFromInterval(
      interval,
      sa,
      positions,
      tokensByFile,
      windowSize,
      minLines,
      maxPunctuationRatio,
    );
    if (candidate) candidates.push(candidate);
  }

  const groups = applyDominanceFilter(candidates, tokensByFile);
  return groups.sort((groupA, groupB) => groupB.lines - groupA.lines);
}

/** One interval that survived every per-interval gate and is eligible to become a
 *  `DuplicateGroup` — pending the cross-interval dominance filter (see
 *  {@link applyDominanceFilter}), which may still drop some or all of its occurrences. */
interface Candidate {
  occurrences: SourcePosition[];
  lcpLength: number;
}

/**
 * @description Converts one LCP interval into a {@link Candidate}, or `undefined` if it fails any
 *   of the checks that disqualify it outright: below `windowSize`, fewer than two real
 *   occurrences, not left-maximal (see {@link isLeftMaximal}), fewer than two occurrences left
 *   after same-file self-overlap exclusion, too punctuation-dense, or shorter than `minLines`.
 *   Stops short of building the final `DuplicateGroup` — {@link applyDominanceFilter} does that,
 *   after possibly dropping some of this candidate's occurrences as redundant with a longer
 *   match. Factored out of {@link findExactDuplicateGroups}'s main loop specifically to keep each
 *   check an early return in its own stack frame rather than an accumulating `continue` chain —
 *   same logic, lower nesting.
 * @param interval - One candidate from {@link buildLcpIntervals}.
 * @param sa - The suffix array `interval.low`/`interval.high` index into.
 * @param positions - Source position for every entry in `sa`.
 * @param tokensByFile - Token streams, for reading lines and punctuation density.
 * @param windowSize - Minimum shared token-run length to report.
 * @param minLines - Minimum merged block size (in source lines) to report, checked against this
 *   candidate's full (pre-dominance-filter) occurrence set — removing occurrences later can only
 *   raise the surviving minimum, never lower it below this threshold, so it's never re-checked.
 * @param maxPunctuationRatio - Maximum structural-punctuation fraction to allow.
 * @returns The {@link Candidate} for this interval, or `undefined` if disqualified.
 */
function candidateFromInterval(
  interval: LcpInterval,
  sa: readonly number[],
  positions: readonly SourcePosition[],
  tokensByFile: ReadonlyMap<string, NormalizedToken[]>,
  windowSize: number,
  minLines: number,
  maxPunctuationRatio: number,
): Candidate | undefined {
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

  const lines = Math.min(
    ...kept.map(({ file, localIndex }) => {
      const tokens = tokensByFile.get(file) as NormalizedToken[];
      const startLine = (tokens[localIndex] as NormalizedToken).line;
      const endLine = (tokens[localIndex + interval.lcpLength - 1] as NormalizedToken).line;
      return endLine - startLine + 1;
    }),
  );
  if (lines < minLines) return undefined;

  return { occurrences: kept, lcpLength: interval.lcpLength };
}

/** A file-local `[start, end)` token-index span already claimed by an accepted (longer, or
 *  equal-and-earlier-processed) match — see {@link applyDominanceFilter}. */
interface AcceptedSpan {
  start: number;
  end: number;
}

/**
 * @description Consolidates a "clone family" — the group of {@link Candidate}s the LCP-interval
 *   tree produces for one shared boilerplate shape, since every node of that tree (a shorter
 *   interval with more occurrences, several longer sibling intervals each covering a subset that
 *   extends the shared prefix further) is individually a valid maximal repeat — into its most
 *   specific members, instead of reporting the whole family as separate groups (see this module's
 *   top-of-file doc comment and docs/known_issues/09-duplicate-clone-family-noise.md).
 *
 *   Processes candidates longest-`lcpLength`-first, maintaining a per-file list of accepted
 *   `[start, start+length)` spans. Drops any occurrence whose span is fully contained in an
 *   already-accepted span in that same file (safe direction: only ever shrinks a candidate, never
 *   grows one), then keeps the survivors' spans as newly-accepted for the next, shorter
 *   candidates. A candidate left with fewer than two surviving occurrences is dropped entirely.
 *
 *   **This is a deliberately lossy heuristic, not a provably-complete one — chosen over the
 *   alternative on purpose.** A stricter version exists (drop a candidate only when *every* one of
 *   its occurrences is covered by the *same single* already-accepted candidate, never a union of
 *   several) that never loses a genuine file-pairing — but analysis and a synthetic probe showed
 *   it barely fires in practice: `isLeftMaximal` already excludes the one case (a shorter
 *   candidate with an *identical* occurrence set to a longer one) that filter could safely act on,
 *   so it left the actual reported noise (near-duplicate, non-identically-positioned matches, and
 *   genuinely branching clone families) untouched. This looser version trims per-occurrence and
 *   can, in a narrow case, silently drop the only report of a real pairing: if file A shares code
 *   with file D *only* via this exact candidate, and D's occurrence in it happens to be spatially
 *   contained in an unrelated longer match (say between files B and C), D gets trimmed out of the
 *   A↔D group here even though that longer match says nothing about A. Accepted trade for
 *   meaningfully less noise — see docs/known_issues/09-duplicate-clone-family-noise.md for the
 *   full reasoning and the deferred connected-component-clustering follow-up that would close this
 *   gap without the completeness loss.
 * @param candidates - Every interval that survived {@link candidateFromInterval}'s gates.
 * @param tokensByFile - Token streams, for reading each surviving occurrence's line span.
 * @returns One `DuplicateGroup` per candidate with ≥2 surviving occurrences.
 */
function applyDominanceFilter(
  candidates: readonly Candidate[],
  tokensByFile: ReadonlyMap<string, NormalizedToken[]>,
): DuplicateGroup[] {
  const sorted = [...candidates].sort((a, b) => b.lcpLength - a.lcpLength);
  const acceptedSpansByFile = new Map<string, AcceptedSpan[]>();
  const groups: DuplicateGroup[] = [];

  for (const candidate of sorted) {
    const survivors = candidate.occurrences.filter(({ file, localIndex }) => {
      const end = localIndex + candidate.lcpLength;
      const spans = acceptedSpansByFile.get(file);
      return !spans?.some((span) => span.start <= localIndex && end <= span.end);
    });
    if (survivors.length < 2) continue;

    for (const { file, localIndex } of survivors) {
      const span: AcceptedSpan = { start: localIndex, end: localIndex + candidate.lcpLength };
      const spans = acceptedSpansByFile.get(file);
      if (spans) spans.push(span);
      else acceptedSpansByFile.set(file, [span]);
    }

    const occurrences: DuplicateOccurrence[] = survivors.map(({ file, localIndex }) => {
      const tokens = tokensByFile.get(file) as NormalizedToken[];
      return {
        file,
        startLine: (tokens[localIndex] as NormalizedToken).line,
        endLine: (tokens[localIndex + candidate.lcpLength - 1] as NormalizedToken).line,
      };
    });
    const lines = Math.min(
      ...occurrences.map((occurrence) => occurrence.endLine - occurrence.startLine + 1),
    );

    groups.push({ occurrences, lines, tokens: candidate.lcpLength });
  }

  return groups;
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
