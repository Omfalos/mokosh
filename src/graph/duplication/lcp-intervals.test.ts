import { describe, expect, test } from "vitest";
import { buildLcpIntervals } from "./lcp-intervals";
import { buildLcpArray, buildSuffixArray } from "./suffix-array";

/** Brute-force reference: for every pair of suffixes, the length of their shared prefix. Used to
 *  verify that every {@link buildLcpIntervals} result correctly reports the *maximal* shared
 *  prefix length for its exact member set — not merely "at least" that length. */
function pairwiseLcp(tokens: readonly string[], a: number, b: number): number {
  let len = 0;
  while (a + len < tokens.length && b + len < tokens.length && tokens[a + len] === tokens[b + len])
    len++;
  return len;
}

describe("buildLcpIntervals", () => {
  test("finds the three maximal repeats of 'banana' (a, ana, na) with correct membership", () => {
    const tokens = "banana".split("");
    const sa = buildSuffixArray(tokens);
    const lcp = buildLcpArray(tokens, sa);
    const intervals = buildLcpIntervals(lcp);

    const bySortedSuffixPositions = intervals
      .map((iv) => ({
        lcpLength: iv.lcpLength,
        positions: sa.slice(iv.low, iv.high + 1).sort((a, b) => a - b),
      }))
      .sort((a, b) => a.lcpLength - b.lcpLength);

    expect(bySortedSuffixPositions).toEqual([
      { lcpLength: 1, positions: [1, 3, 5] }, // "a" at the three a-starting positions
      { lcpLength: 2, positions: [2, 4] }, // "na"
      { lcpLength: 3, positions: [1, 3] }, // "ana"
    ]);
  });

  test("every interval's members truly share its reported lcpLength as their exact common prefix", () => {
    const alphabet = ["a", "b", "c"];
    for (let trial = 0; trial < 30; trial++) {
      const length = 2 + Math.floor(Math.random() * 25);
      const tokens = Array.from(
        { length },
        () => alphabet[Math.floor(Math.random() * alphabet.length)] as string,
      );
      const sa = buildSuffixArray(tokens);
      const lcp = buildLcpArray(tokens, sa);
      const intervals = buildLcpIntervals(lcp);

      for (const iv of intervals) {
        expect(iv.high).toBeGreaterThan(iv.low); // every interval spans >=2 suffixes
        const positions = sa.slice(iv.low, iv.high + 1);
        // The reported length must be a lower bound for every pair in the interval...
        for (let i = 0; i < positions.length; i++) {
          for (let j = i + 1; j < positions.length; j++) {
            const shared = pairwiseLcp(tokens, positions[i] as number, positions[j] as number);
            expect(shared).toBeGreaterThanOrEqual(iv.lcpLength);
          }
        }
        // ...and tight for at least the adjacent pair that defines it (min over the LCP range).
        const adjacentMin = Math.min(
          ...lcp.slice(iv.low + 1, iv.high + 1).filter((_, idx) => idx + iv.low + 1 <= iv.high),
        );
        expect(adjacentMin).toBe(iv.lcpLength);
      }
    }
  });

  test("returns nothing for a token stream with no repeats", () => {
    const tokens = "abcdef".split("");
    const sa = buildSuffixArray(tokens);
    const lcp = buildLcpArray(tokens, sa);
    expect(buildLcpIntervals(lcp)).toEqual([]);
  });

  test("handles empty and single-token input", () => {
    expect(buildLcpIntervals(buildLcpArray([], buildSuffixArray([])))).toEqual([]);
    expect(buildLcpIntervals(buildLcpArray(["a"], buildSuffixArray(["a"])))).toEqual([]);
  });
});
