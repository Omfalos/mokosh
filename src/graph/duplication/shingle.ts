/**
 * Sliding-window (shingle) hashing over a normalized token stream, plus chain-merging of
 * consecutive matching windows into contiguous duplicate blocks, a structural-punctuation-density
 * gate that drops blocks that are mostly object/array-literal shape (e.g. MCP tool `inputSchema`
 * boilerplate) rather than substantive shared logic, and exact-occurrence clustering of pair-
 * matches into one N-occurrence group instead of reporting C(N,2) near-identical pairs for a block
 * repeated N times. Shared by every language `tokenize()` supports — the shingling step itself has
 * no language awareness at all. See docs/adr-013-duplicate-detection-noise-reduction.md for the
 * noise this addresses, and docs/adr-014-duplicate-detection-scale.md for why oversized hash
 * buckets are capped below.
 */
import type { DuplicateFamily } from "./families";
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
  /** Every location sharing this duplicated block (two or more) — locations that pairwise
   *  chain-match are clustered into one group instead of being reported once per pair, so a
   *  block repeated N times produces one N-occurrence group, not C(N,2) near-identical ones. */
  occurrences: DuplicateOccurrence[];
  /** Line span of the largest single pairwise match clustered into this group (each pair's own
   *  span is the shorter of its two occurrences) — the best-verified size for this block, not an
   *  average or a value shrunk by a more weakly-matching cluster member. */
  lines: number;
  /** Token-window length backing this block, after chain-merging adjacent windows. */
  tokens: number;
  /** Which language family both occurrences belong to (set by `findDuplicates`, which never
   *  matches across families — see docs/adr-013-duplicate-detection-noise-reduction.md).
   *  Absent when called directly with a token stream that isn't family-scoped, e.g. in tests. */
  family?: DuplicateFamily | undefined;
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

/** Plain union-find over opaque string keys, path-compressed. Used below to cluster pair-matches
 *  that share an *exact* occurrence — same file and identical start/end line — into one group,
 *  rather than one report per pair. Deliberately not transitive over "chain-matches some other
 *  location that chain-matches a third" in general: two different (file, start) locations can
 *  each independently chain-match a shared window to very different lengths (e.g. one long
 *  genuine clone plus, separately, several short internally-repeated sub-patterns within it), and
 *  merging on that looser basis would force every member down to the shortest edge's length,
 *  silently discarding the strongest match. Requiring an exact shared span sidesteps that: it
 *  only fires when two independently-computed pair-matches agree on the very same block for one
 *  of their two sides (the same repeated-boilerplate location matched against several others),
 *  which is exactly the pair-explosion case this clustering targets. */
class ExactOccurrenceUnionFind {
  private readonly parent = new Map<string, string>();

  private find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cur = key;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(keyA: string, keyB: string): void {
    const rootA = this.find(keyA);
    const rootB = this.find(keyB);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  root(key: string): string {
    return this.find(key);
  }
}

/** `"<file>#<startLine>#<endLine>"` — exact-span identity for one reported occurrence. */
function occurrenceKey(occ: DuplicateOccurrence): string {
  return `${occ.file}#${occ.startLine}#${occ.endLine}`;
}

/** Object/array-literal structural punctuation — braces, colons, commas, brackets. Deliberately
 *  narrower than "all punctuation": parens and semicolons are just as common in ordinary control
 *  flow and would blur the signal below. */
const STRUCTURAL_PUNCTUATION = new Set(["{", "}", ":", ",", "[", "]"]);

/**
 * @description The fraction of a token window's texts that are object/array-literal structural
 *   punctuation (`{ } : , [ ]`), used to gate out blocks that are mostly object-literal/schema
 *   shape — e.g. MCP tool `inputSchema` boilerplate repeated across unrelated tool definitions —
 *   rather than substantive shared logic. An earlier version of this gate measured *identifier*
 *   diversity instead (rejecting windows where too few distinct token texts appear), but that
 *   measure doesn't distinguish schema boilerplate from genuine duplication: table-driven test
 *   fixtures (deliberately mirrored across, e.g., parallel Go/Python test suites) are just as
 *   token-repetitive as schema boilerplate, so it silently discarded real matches. Punctuation
 *   density instead targets the *shape* that's actually distinctive about object/schema literals
 *   — dense braces/colons/commas relative to keywords and content — which genuine control-flow
 *   logic and repeated test-fixture data don't share, verified empirically against mokosh's own
 *   codebase (~0.60–0.74 for schema boilerplate vs. ~0.07–0.43 for real duplicated logic,
 *   including table-driven test fixtures). See docs/adr-013-duplicate-detection-noise-reduction.md.
 * @param tokens - The full token stream a window is sliced from.
 * @param start - Window start index.
 * @param length - Window length in tokens.
 * @returns `structuralPunctuationTokens / length`, in `[0, 1]`.
 */
export function structuralPunctuationRatio(
  tokens: NormalizedToken[],
  start: number,
  length: number,
): number {
  let count = 0;
  for (let i = start; i < start + length; i++) {
    if (STRUCTURAL_PUNCTUATION.has((tokens[i] as NormalizedToken).text)) count++;
  }
  return count / length;
}

interface PairMatch {
  occA: DuplicateOccurrence;
  occB: DuplicateOccurrence;
  lines: number;
  tokens: number;
}

/**
 * Default cap on how many locations a single hash bucket may hold before its pairwise comparison
 * is skipped outright. Comparison cost per bucket is O(k²) in the bucket's location count `k`; on
 * a large enough repo, a single ubiquitous window (a common import line, a boilerplate header —
 * exactly the kind of token pattern `maxPunctuationRatio` already exists to filter, but *before*
 * chain-extension has run) can produce a bucket with thousands of locations, and just a handful of
 * those buckets is enough to blow the total comparison count past what a single MCP call can
 * finish inside its client's response timeout. Skipped buckets are almost always this kind of
 * high-frequency boilerplate rather than a single large genuine clone (a real N-way clone repeated
 * this often would itself be unusual), so the cap trades a small chance of under-reporting
 * extremely widespread duplication for the pipeline finishing at all. See
 * docs/adr-014-duplicate-detection-scale.md.
 */
const DEFAULT_MAX_BUCKET_SIZE = 400;

/** Shared read-only context passed to the per-pair and per-bucket matching steps below — bundled
 *  so each step's signature stays narrow (a handful of related lookups) instead of threading five
 *  separate maps/scalars through every call. */
interface MatchContext {
  hashesByFile: Map<string, string[]>;
  tokensByFile: Map<string, NormalizedToken[]>;
  windowSize: number;
  minLines: number;
  maxPunctuationRatio: number;
}

/**
 * @description Hashes every `windowSize`-token sliding window for each file and groups window
 *   locations by hash, so same-hash windows across (or within) files can be compared pairwise.
 * @param files - Per-file normalized token streams (already comment-stripped and identifier/
 *   literal-normalized by `tokenize`).
 * @param windowSize - Shingle window length in tokens — the smallest duplicate this can find.
 * @returns Per-file window hashes, per-file tokens, and window locations grouped by hash.
 */
function buildHashIndex(
  files: FileTokens[],
  windowSize: number,
): {
  hashesByFile: Map<string, string[]>;
  tokensByFile: Map<string, NormalizedToken[]>;
  buckets: Map<string, Location[]>;
} {
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

  return { hashesByFile, tokensByFile, buckets };
}

/**
 * @description Evaluates one candidate window pair from the same hash bucket against every
 *   filter a match must clear — chain-start position, structural-punctuation density, same-file
 *   self-overlap, and the `minLines` floor — and, if it clears all of them, builds the resulting
 *   pair match. Each gate is a single early return, which is what keeps this readable despite
 *   testing four independent conditions: the whole point of factoring the pair out of the bucket
 *   loop is that this function has exactly one input pair to reason about at a time.
 * @param a - Starting location in the first file.
 * @param b - Starting location in the second file.
 * @param ctx - Shared hash/token lookups and thresholds for the current run.
 * @returns The pair match, or `undefined` if `(a, b)` isn't a valid reportable match.
 */
function tryMatchPair(a: Location, b: Location, ctx: MatchContext): PairMatch | undefined {
  if (a.file === b.file && a.windowIndex === b.windowIndex) return undefined;
  if (!isChainStart(ctx.hashesByFile, a, b)) return undefined;

  const extra = extendChain(ctx.hashesByFile, a, b);
  const length = ctx.windowSize + extra;

  const tokensA = ctx.tokensByFile.get(a.file) as NormalizedToken[];
  if (structuralPunctuationRatio(tokensA, a.windowIndex, length) > ctx.maxPunctuationRatio)
    return undefined;

  // Same-file self-overlap isn't a real duplicate (it's just the same span vs itself).
  if (a.file === b.file) {
    const [lo, hi] = a.windowIndex < b.windowIndex ? [a, b] : [b, a];
    if (lo.windowIndex + length > hi.windowIndex) return undefined;
  }

  const tokensB = ctx.tokensByFile.get(b.file) as NormalizedToken[];
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
  const lines = Math.min(occA.endLine - occA.startLine + 1, occB.endLine - occB.startLine + 1);
  if (lines < ctx.minLines) return undefined;

  return { occA, occB, lines, tokens: length };
}

/**
 * @description Runs {@link tryMatchPair} over every location pair within one hash bucket.
 * @param locations - Window locations that all share one hash.
 * @param ctx - Shared hash/token lookups and thresholds for the current run.
 * @returns Every valid pair match found within the bucket.
 */
function matchPairsInBucket(locations: Location[], ctx: MatchContext): PairMatch[] {
  const matches: PairMatch[] = [];
  for (let i = 0; i < locations.length; i++) {
    for (let j = i + 1; j < locations.length; j++) {
      const match = tryMatchPair(locations[i] as Location, locations[j] as Location, ctx);
      if (match) matches.push(match);
    }
  }
  return matches;
}

/**
 * @description Compares locations within each hash bucket pairwise via {@link matchPairsInBucket},
 *   skipping buckets larger than `maxBucketSize` outright since their O(k²) comparison cost is
 *   almost always spent on ubiquitous boilerplate rather than a genuine large clone — see
 *   {@link DEFAULT_MAX_BUCKET_SIZE}'s doc comment.
 * @param buckets - Window locations grouped by hash, from {@link buildHashIndex}.
 * @param ctx - Shared hash/token lookups and thresholds for the current run.
 * @param maxBucketSize - Skip a bucket's comparison entirely once it holds more than this many
 *   locations.
 * @returns Every valid pair match across all buckets, plus how many buckets were skipped.
 */
function collectPairMatches(
  buckets: Map<string, Location[]>,
  ctx: MatchContext,
  maxBucketSize: number,
): { pairMatches: PairMatch[]; skippedBuckets: number } {
  const pairMatches: PairMatch[] = [];
  let skippedBuckets = 0;

  for (const locations of buckets.values()) {
    if (locations.length < 2) continue;
    if (locations.length > maxBucketSize) {
      skippedBuckets++;
      continue;
    }
    pairMatches.push(...matchPairsInBucket(locations, ctx));
  }

  return { pairMatches, skippedBuckets };
}

/**
 * @description The best (largest) pairwise match fully contained in a cluster of occurrence keys
 *   — reported as the group's size, rather than a value shrunk by an unrelated, more weakly-
 *   matching cluster member.
 * @param keys - Occurrence keys belonging to one cluster.
 * @param pairMatches - Every pair match found, from {@link collectPairMatches}.
 * @param windowSize - Fallback token length if no pair match's tokens exceed the initial `lines`
 *   value (kept identical to the pre-refactor behavior).
 * @returns The cluster's best `lines`/`tokens` pair.
 */
function bestMatchInCluster(
  keys: Set<string>,
  pairMatches: PairMatch[],
  windowSize: number,
): { lines: number; tokens: number } {
  let lines = 0;
  let tokens = windowSize;
  for (const pm of pairMatches) {
    if (!keys.has(occurrenceKey(pm.occA)) || !keys.has(occurrenceKey(pm.occB))) continue;
    if (pm.lines > lines) {
      lines = pm.lines;
      tokens = pm.tokens;
    }
  }
  return { lines, tokens };
}

/**
 * @description Merges pair-matches that share an exact occurrence (same file, same start/end
 *   line on one side) into single groups — so a block repeated N times across the project is
 *   reported once, with N occurrences, instead of once per pair. See
 *   {@link ExactOccurrenceUnionFind}'s doc comment for why clustering is scoped to *exact* shared
 *   spans rather than being transitive over chain-matches in general.
 * @param pairMatches - Every pair match found, from {@link collectPairMatches}.
 * @param windowSize - Passed through to {@link bestMatchInCluster}.
 * @returns Duplicate groups, each with two or more occurrences, unsorted.
 */
function clusterPairMatches(pairMatches: PairMatch[], windowSize: number): DuplicateGroup[] {
  const clusters = new ExactOccurrenceUnionFind();
  const occurrenceByKey = new Map<string, DuplicateOccurrence>();
  for (const { occA, occB } of pairMatches) {
    const keyA = occurrenceKey(occA);
    const keyB = occurrenceKey(occB);
    occurrenceByKey.set(keyA, occA);
    occurrenceByKey.set(keyB, occB);
    clusters.union(keyA, keyB);
  }

  const keysByRoot = new Map<string, Set<string>>();
  for (const key of occurrenceByKey.keys()) {
    const root = clusters.root(key);
    const keys = keysByRoot.get(root);
    if (keys) keys.add(key);
    else keysByRoot.set(root, new Set([key]));
  }

  const groups: DuplicateGroup[] = [];
  for (const keys of keysByRoot.values()) {
    if (keys.size < 2) continue;
    const occurrences = [...keys].map((key) => occurrenceByKey.get(key) as DuplicateOccurrence);
    const { lines, tokens } = bestMatchInCluster(keys, pairMatches, windowSize);
    groups.push({ occurrences, lines, tokens });
  }

  return groups;
}

/**
 * @description Builds duplicate groups from a set of files' token streams: hashes every
 *   `windowSize`-token sliding window per file, pairs up locations sharing a hash, chain-merges
 *   each chain-starting pair forward into the longest contiguous block it starts (exactly as a
 *   pairwise-only detector would), drops pairs whose block is mostly object/array-literal
 *   structural punctuation rather than substantive content, then merges pair-matches that share
 *   an exact occurrence (same file, same start/end line on one side) into a single group — so a
 *   block repeated N times across the project is reported once, with N occurrences, instead of
 *   once per pair, without shortening any individual match to accommodate an unrelated one.
 *
 *   Broken into three steps, each independently testable: {@link buildHashIndex} (hash every
 *   window), {@link collectPairMatches} (find valid pairwise matches), {@link clusterPairMatches}
 *   (merge matches into groups).
 * @param files - Per-file normalized token streams (already comment-stripped and identifier/
 *   literal-normalized by `tokenize`).
 * @param windowSize - Shingle window length in tokens — the smallest duplicate this can find.
 * @param minLines - Minimum merged block size (in source lines) to report; smaller matches
 *   are almost always incidental (short getters, boilerplate imports) rather than real
 *   duplication.
 * @param maxPunctuationRatio - Maximum fraction of a block's window that may be object/array-
 *   literal structural punctuation (default 0.5) — see {@link structuralPunctuationRatio}. Set
 *   to 1 to disable the gate.
 * @param maxBucketSize - Skip a hash bucket's O(k²) pairwise comparison entirely once it holds
 *   more than this many locations (default {@link DEFAULT_MAX_BUCKET_SIZE}) — see the constant's
 *   doc comment. Set to `Infinity` to disable.
 * @returns Duplicate blocks, each with two or more occurrences, sorted largest-first, plus
 *   `skippedBuckets` — how many hash buckets were dropped for exceeding `maxBucketSize` (0 when
 *   the cap never triggered), so callers can surface that results may be incomplete.
 */
export function findDuplicateGroups(
  files: FileTokens[],
  windowSize: number,
  minLines: number,
  maxPunctuationRatio = 0.5,
  maxBucketSize = DEFAULT_MAX_BUCKET_SIZE,
): { groups: DuplicateGroup[]; skippedBuckets: number } {
  const { hashesByFile, tokensByFile, buckets } = buildHashIndex(files, windowSize);
  const ctx: MatchContext = {
    hashesByFile,
    tokensByFile,
    windowSize,
    minLines,
    maxPunctuationRatio,
  };
  const { pairMatches, skippedBuckets } = collectPairMatches(buckets, ctx, maxBucketSize);
  const groups = clusterPairMatches(pairMatches, windowSize);

  return { groups: groups.sort((a, b) => b.lines - a.lines), skippedBuckets };
}
