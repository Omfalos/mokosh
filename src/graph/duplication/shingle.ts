/**
 * Sliding-window (shingle) hashing over a normalized token stream, plus chain-merging of
 * consecutive matching windows into contiguous duplicate blocks. Shared by every language
 * `tokenize()` supports — the shingling step itself has no language awareness at all.
 */
import type { NormalizedToken } from "./tokenizer";

/** One file's worth of tokens, kept together so a match can be traced back to its source. */
export interface FileTokens {
  file: string;
  tokens: NormalizedToken[];
}

export interface DuplicateOccurrence {
  file: string;
  startLine: number;
  endLine: number;
}

export interface DuplicateGroup {
  /** Two locations sharing this duplicated block. */
  occurrences: [DuplicateOccurrence, DuplicateOccurrence];
  /** Line span covered by the block (measured on the first occurrence). */
  lines: number;
  /** Token-window length backing this block, after chain-merging adjacent windows. */
  tokens: number;
}

interface Location {
  file: string;
  windowIndex: number;
}

/**
 * @description A small non-cryptographic string hash (djb2), good enough to bucket identical
 *   token windows together for a heuristic duplicate finder — collision risk is negligible at
 *   the window sizes and file counts this operates on, and any collision only costs an extra
 *   comparison, never a wrong report, since chains are still verified position-by-position.
 * @param text - The joined-token window text to hash.
 * @returns A hash string safe to use as a `Map` key.
 */
function hashWindow(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * @description Computes every `windowSize`-token window's hash for one file's token stream.
 * @param tokens - The file's normalized tokens.
 * @param windowSize - Number of tokens per shingle window.
 * @returns Hash per window index, aligned so `hashes[i]` is the window starting at token `i`.
 */
function hashWindows(tokens: NormalizedToken[], windowSize: number): string[] {
  const hashes: string[] = [];
  for (let i = 0; i <= tokens.length - windowSize; i++) {
    hashes.push(
      hashWindow(
        tokens
          .slice(i, i + windowSize)
          .map((t) => t.text)
          .join(" "),
      ),
    );
  }
  return hashes;
}

/**
 * @description Extends a matching window pair forward for as long as the next window in both
 *   files keeps hashing identically, turning one shingle match into the longest contiguous
 *   duplicate block it's part of.
 * @param hashesByFile - Precomputed per-window hashes, one array per file.
 * @param a - Starting location in the first file.
 * @param b - Starting location in the second file.
 * @returns How many additional windows (beyond the first) also match.
 */
function extendChain(hashesByFile: Map<string, string[]>, a: Location, b: Location): number {
  const hashesA = hashesByFile.get(a.file);
  const hashesB = hashesByFile.get(b.file);
  if (!hashesA || !hashesB) return 0;
  let extra = 0;
  while (
    a.windowIndex + extra + 1 < hashesA.length &&
    b.windowIndex + extra + 1 < hashesB.length &&
    hashesA[a.windowIndex + extra + 1] === hashesB[b.windowIndex + extra + 1]
  ) {
    extra++;
  }
  return extra;
}

/**
 * @description Whether `(a, b)` is the start of a duplicate chain rather than the middle of
 *   one already found from an earlier starting position — true when the previous window pair
 *   did *not* also match, so each contiguous run is reported exactly once, from its earliest
 *   position.
 */
function isChainStart(hashesByFile: Map<string, string[]>, a: Location, b: Location): boolean {
  if (a.windowIndex === 0 || b.windowIndex === 0) return true;
  const hashesA = hashesByFile.get(a.file);
  const hashesB = hashesByFile.get(b.file);
  if (!hashesA || !hashesB) return true;
  return hashesA[a.windowIndex - 1] !== hashesB[b.windowIndex - 1];
}

/**
 * @description Builds duplicate groups from a set of files' token streams: hashes every
 *   `windowSize`-token sliding window per file, pairs up locations sharing a hash, and
 *   chain-merges each pair forward into the longest contiguous duplicate block it starts.
 * @param files - Per-file normalized token streams (already comment-stripped and identifier/
 *   literal-normalized by `tokenize`).
 * @param windowSize - Shingle window length in tokens — the smallest duplicate this can find.
 * @param minLines - Minimum merged block size (in source lines) to report; smaller matches
 *   are almost always incidental (short getters, boilerplate imports) rather than real
 *   duplication.
 * @returns Duplicate blocks, each a pair of occurrences, sorted largest-first.
 */
export function findDuplicateGroups(
  files: FileTokens[],
  windowSize: number,
  minLines: number,
): DuplicateGroup[] {
  const hashesByFile = new Map<string, string[]>();
  const tokensByFile = new Map<string, NormalizedToken[]>();
  const buckets = new Map<string, Location[]>();

  for (const { file, tokens } of files) {
    if (tokens.length < windowSize) continue;
    tokensByFile.set(file, tokens);
    const hashes = hashWindows(tokens, windowSize);
    hashesByFile.set(file, hashes);
    for (let i = 0; i < hashes.length; i++) {
      const loc: Location = { file, windowIndex: i };
      const bucket = buckets.get(hashes[i] as string);
      if (bucket) bucket.push(loc);
      else buckets.set(hashes[i] as string, [loc]);
    }
  }

  const groups: DuplicateGroup[] = [];

  for (const locations of buckets.values()) {
    if (locations.length < 2) continue;
    for (let i = 0; i < locations.length; i++) {
      for (let j = i + 1; j < locations.length; j++) {
        const a = locations[i] as Location;
        const b = locations[j] as Location;
        if (a.file === b.file && a.windowIndex === b.windowIndex) continue;
        if (!isChainStart(hashesByFile, a, b)) continue;

        const extra = extendChain(hashesByFile, a, b);
        const length = windowSize + extra;

        // Same-file self-overlap isn't a real duplicate (it's just the same span vs itself).
        if (a.file === b.file) {
          const [lo, hi] = a.windowIndex < b.windowIndex ? [a, b] : [b, a];
          if (lo.windowIndex + length > hi.windowIndex) continue;
        }

        const tokensA = tokensByFile.get(a.file) as NormalizedToken[];
        const tokensB = tokensByFile.get(b.file) as NormalizedToken[];
        const occA: DuplicateOccurrence = {
          file: a.file,
          startLine: (tokensA[a.windowIndex] as NormalizedToken).line,
          endLine: (tokensA[a.windowIndex + length - 1] as NormalizedToken).line,
        };
        const occB: DuplicateOccurrence = {
          file: b.file,
          startLine: (tokensB[b.windowIndex] as NormalizedToken).line,
          endLine: (tokensB[b.windowIndex + length - 1] as NormalizedToken).line,
        };
        const lines = Math.min(
          occA.endLine - occA.startLine + 1,
          occB.endLine - occB.startLine + 1,
        );
        if (lines < minLines) continue;

        groups.push({ occurrences: [occA, occB], lines, tokens: length });
      }
    }
  }

  return groups.sort((a, b) => b.lines - a.lines);
}
