/**
 * Suffix array + LCP (longest-common-prefix) array construction over a token stream. Foundation
 * for exact, complete repeated-substring enumeration (`lcp-intervals.ts`), replacing the
 * hash-shingle-bucket matcher's O(k²)-per-bucket worst case with an O(n log n) / O(n) pipeline
 * that has no pathological blowup case to guard against. See
 * docs/adr-015-suffix-array-duplicate-detection.md.
 */

/**
 * @description Builds the suffix array of `tokens` — the permutation of `[0, n)` that visits
 *   every starting position in lexicographically-sorted order of the suffix starting there,
 *   using each string in `tokens` as one atomic "character" of the alphabet (so this operates on
 *   a token stream, not raw source text). Classic prefix-doubling construction (Manber–Myers):
 *   each round refines every position's rank using the previous round's ranks at `i` and
 *   `i+step`, doubling the effective comparison length each time, so after `O(log n)` rounds
 *   every suffix is fully ordered. `i+step` past the array end is treated as rank `-1` — lower
 *   than every real rank — which gives the same ordering an explicit end-of-string sentinel
 *   would, without needing one.
 * @param tokens - Token stream to index (already comment-stripped/normalized upstream).
 * @returns The suffix array: `result[i]` is the starting position of the `i`-th suffix in sorted
 *   order. Empty for an empty input.
 */
export function buildSuffixArray(tokens: readonly string[]): number[] {
  const tokenCount = tokens.length;
  if (tokenCount === 0) return [];

  const sa = Array.from({ length: tokenCount }, (_, i) => i);
  let rank = new Array<number>(tokenCount);
  {
    const uniqueSorted = [...new Set(tokens)].sort();
    const rankOf = new Map(uniqueSorted.map((t, i) => [t, i]));
    for (let i = 0; i < tokenCount; i++) rank[i] = rankOf.get(tokens[i] as string) as number;
  }

  let next = new Array<number>(tokenCount).fill(0);
  for (let step = 1; step < tokenCount; step *= 2) {
    const secondaryKey = (i: number): number =>
      i + step < tokenCount ? (rank[i + step] as number) : -1;
    sa.sort((posA, posB) => {
      const primary = (rank[posA] as number) - (rank[posB] as number);
      if (primary !== 0) return primary;
      return secondaryKey(posA) - secondaryKey(posB);
    });

    next[sa[0] as number] = 0;
    for (let i = 1; i < tokenCount; i++) {
      const prev = sa[i - 1] as number;
      const cur = sa[i] as number;
      const samePrimary = rank[prev] === rank[cur];
      const sameSecondary = secondaryKey(prev) === secondaryKey(cur);
      next[cur] = (next[prev] as number) + (samePrimary && sameSecondary ? 0 : 1);
    }
    [rank, next] = [next, rank];

    // Every suffix has a distinct rank — fully sorted, no benefit to further doubling rounds.
    if (rank[sa[tokenCount - 1] as number] === tokenCount - 1) break;
  }

  return sa;
}

/**
 * @description Builds the LCP (longest-common-prefix) array for `tokens` given its suffix array
 *   `sa` — Kasai's algorithm, O(n) amortized. `result[i]` is the length (in tokens) of the shared
 *   prefix between the suffixes at sorted positions `i-1` and `i`; `result[0]` is always `0`
 *   (sentinel — sorted position `0` has no predecessor to share a prefix with).
 * @param tokens - The same token stream `sa` was built from.
 * @param sa - The suffix array from {@link buildSuffixArray}.
 * @returns The LCP array, same length as `sa`.
 */
export function buildLcpArray(tokens: readonly string[], sa: readonly number[]): number[] {
  const tokenCount = tokens.length;
  const lcp = new Array<number>(tokenCount).fill(0);
  if (tokenCount === 0) return lcp;

  const rankOfPosition = new Array<number>(tokenCount);
  for (let i = 0; i < tokenCount; i++) rankOfPosition[sa[i] as number] = i;

  let commonLength = 0;
  for (let i = 0; i < tokenCount; i++) {
    const saIndex = rankOfPosition[i] as number;
    if (saIndex > 0) {
      const neighborPos = sa[saIndex - 1] as number;
      while (
        i + commonLength < tokenCount &&
        neighborPos + commonLength < tokenCount &&
        tokens[i + commonLength] === tokens[neighborPos + commonLength]
      )
        commonLength++;
      lcp[saIndex] = commonLength;
      if (commonLength > 0) commonLength--;
    } else {
      commonLength = 0;
    }
  }
  return lcp;
}
