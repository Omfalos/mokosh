/**
 * Enumerates the LCP-interval tree from an LCP array — the internal-node structure of the
 * (implicit) generalized suffix tree, without building the tree itself. Each interval is a
 * maximal contiguous run of the suffix array whose members all share a common prefix of exactly
 * `lcpLength` tokens; that's precisely one candidate duplicate-code group. Bottom-up monotonic-
 * stack construction (Abouelhoda, Kurtz & Ohlebusch, "Replacing Suffix Trees with Enhanced Suffix
 * Arrays", 2004) — O(n) total, and critically, the number of intervals is bounded by `n`
 * regardless of how repetitive the input is: unlike the hash-shingle-bucket matcher this replaces
 * (`shingle.ts`), there is no pathological case where a common token pattern blows up comparison
 * cost, so no `maxBucketSize`-style safety cap is needed. See
 * docs/adr-015-suffix-array-duplicate-detection.md.
 */

/** One node of the LCP-interval tree: suffix-array positions `[low, high]` (inclusive) all share
 *  a common prefix of exactly `lcpLength` tokens — not merely "at least", since this is the
 *  maximal contiguous range at that exact depth. */
export interface LcpInterval {
  lcpLength: number;
  low: number;
  high: number;
}

interface StackFrame {
  lcpLength: number;
  low: number;
}

/**
 * @description Walks the LCP array left to right with a monotonically-increasing stack of open
 *   intervals, closing (and emitting) an interval whenever a shallower common-prefix depth is
 *   reached, exactly as a bottom-up suffix-tree traversal would. Intervals at the same depth that
 *   are adjacent in the LCP array merge into one (handled by the `<=` check re-comparing against
 *   the new stack top after each pop) rather than being reported as separate same-depth siblings.
 * @param lcp - An LCP array from {@link buildLcpArray} (`lcp[0]` must be the `0` sentinel it
 *   always produces).
 * @returns Every internal node of the LCP-interval tree, unordered. A node with `low === high`
 *   never occurs — every interval spans at least two suffix-array positions, i.e. at least two
 *   occurrences.
 */
export function buildLcpIntervals(lcp: readonly number[]): LcpInterval[] {
  const arrayLength = lcp.length;
  const intervals: LcpInterval[] = [];
  const stack: StackFrame[] = [{ lcpLength: 0, low: 0 }];

  for (let i = 1; i < arrayLength; i++) {
    let low = i - 1;
    while ((lcp[i] as number) < (stack[stack.length - 1] as StackFrame).lcpLength) {
      const top = stack.pop() as StackFrame;
      intervals.push({ lcpLength: top.lcpLength, low: top.low, high: i - 1 });
      low = top.low;
    }
    if ((lcp[i] as number) > (stack[stack.length - 1] as StackFrame).lcpLength) {
      stack.push({ lcpLength: lcp[i] as number, low });
    }
    // Equal to the current stack top: position i belongs to that still-open interval — nothing
    // to push, it will be emitted (with its right bound extended to cover i) when eventually
    // popped by a later, shallower position.
  }

  while (stack.length > 1) {
    const top = stack.pop() as StackFrame;
    intervals.push({ lcpLength: top.lcpLength, low: top.low, high: arrayLength - 1 });
  }

  return intervals;
}
