import { describe, expect, it } from "vitest";
import { buildDuplicateClusters } from "./clusters";
import { dedupeGroupsAgainstClusters, slimDupCluster } from "./shape";
import type { DuplicateGroup } from "./shingle";

function group(
  occurrences: Array<{ file: string; startLine: number; endLine: number }>,
  lines: number,
): DuplicateGroup {
  return { occurrences, lines, tokens: lines * 4 };
}

describe("slimDupCluster", () => {
  it("carries longestMatchAt — the biggest member group's occurrence spans", () => {
    const small = group(
      [
        { file: "a.ts", startLine: 1, endLine: 8 },
        { file: "b.ts", startLine: 40, endLine: 47 },
      ],
      8,
    );
    const big = group(
      [
        { file: "a.ts", startLine: 100, endLine: 150 },
        { file: "b.ts", startLine: 200, endLine: 250 },
      ],
      51,
    );
    const [cluster] = buildDuplicateClusters([small, big]);
    const slim = slimDupCluster(cluster as never);

    expect(slim.longestMatch).toBe(51);
    expect(slim.longestMatchAt).toEqual(["a.ts:100-150", "b.ts:200-250"]);
  });
});

describe("dedupeGroupsAgainstClusters", () => {
  const ab1 = group(
    [
      { file: "a.ts", startLine: 1, endLine: 10 },
      { file: "b.ts", startLine: 1, endLine: 10 },
    ],
    10,
  );
  const ab2 = group(
    [
      { file: "a.ts", startLine: 30, endLine: 38 },
      { file: "b.ts", startLine: 30, endLine: 38 },
    ],
    8,
  );
  const cd = group(
    [
      { file: "c.ts", startLine: 1, endLine: 12 },
      { file: "d.ts", startLine: 1, endLine: 12 },
    ],
    12,
  );

  it("drops groups that are members of a returned multi-member cluster, keeps the rest", () => {
    // a.ts/b.ts share two matches -> one cluster with matchCount 2; c.ts/d.ts share one.
    const clusters = buildDuplicateClusters([ab1, ab2, cd]);
    const multiMember = clusters.filter((c) => c.matchCount > 1);
    expect(multiMember).toHaveLength(1);

    const kept = dedupeGroupsAgainstClusters([ab1, ab2, cd], multiMember);
    expect(kept).toEqual([cd]);
  });

  it("keeps every group when no returned cluster has more than one member", () => {
    const singles = buildDuplicateClusters([ab1, cd]); // both matchCount 1
    const kept = dedupeGroupsAgainstClusters([ab1, cd], singles);
    expect(kept).toEqual([ab1, cd]);
  });

  it("keeps a group whose file set matches no returned cluster", () => {
    const clusters = buildDuplicateClusters([ab1, ab2]); // one multi-member cluster for a/b
    const kept = dedupeGroupsAgainstClusters([ab1, ab2, cd], clusters);
    expect(kept).toEqual([cd]);
  });
});
