import { describe, expect, it } from "vitest";
import { buildDuplicateClusters } from "./clusters";
import type { DuplicateGroup } from "./shingle";

function group(
  occurrences: Array<{ file: string; startLine: number; endLine: number }>,
  lines: number,
): DuplicateGroup {
  return { occurrences, lines, tokens: lines * 4 };
}

describe("buildDuplicateClusters", () => {
  it("merges many non-nested matches between the same two files into one cluster", () => {
    // The "window-splitting" case: ContentExplorer.tsx <-> ContentPicker.js sharing 14 separate,
    // non-overlapping matches should read as one cluster, not 14 unrelated rows.
    const groups: DuplicateGroup[] = Array.from({ length: 14 }, (_, i) =>
      group(
        [
          { file: "a.ts", startLine: i * 10, endLine: i * 10 + 8 },
          { file: "b.ts", startLine: i * 10 + 100, endLine: i * 10 + 108 },
        ],
        8,
      ),
    );

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.files).toEqual(["a.ts", "b.ts"]);
    expect(clusters[0]?.matchCount).toBe(14);
    expect(clusters[0]?.longestMatch).toBe(8);
    expect(clusters[0]?.groups).toHaveLength(14);
  });

  it("keeps unrelated file pairs in separate clusters", () => {
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 10 },
          { file: "b.ts", startLine: 1, endLine: 10 },
        ],
        10,
      ),
      group(
        [
          { file: "c.ts", startLine: 1, endLine: 20 },
          { file: "d.ts", startLine: 1, endLine: 20 },
        ],
        20,
      ),
    ];

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(2);
    // Largest-longestMatch-first.
    expect(clusters[0]?.files).toEqual(["c.ts", "d.ts"]);
    expect(clusters[1]?.files).toEqual(["a.ts", "b.ts"]);
  });

  it("does not transitively chain through a shared bridge file (regression: single-linkage chaining)", () => {
    // a<->b via one group, b<->c via a different, unrelated group. B is a genuine bridge (it
    // duplicates code with both), but that says nothing about A and C relating to each other —
    // transitively merging all three into one cluster is exactly the chaining failure mode found
    // on a real repo (803 files / 4,853 groups collapsed into one "cluster"). Each distinct file
    // set gets its own cluster instead.
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 10 },
          { file: "b.ts", startLine: 1, endLine: 10 },
        ],
        10,
      ),
      group(
        [
          { file: "b.ts", startLine: 50, endLine: 60 },
          { file: "c.ts", startLine: 1, endLine: 11 },
        ],
        11,
      ),
    ];

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.files)).toEqual([
      ["b.ts", "c.ts"],
      ["a.ts", "b.ts"],
    ]);
  });

  it("clusters an N-way group's files together via that one group alone", () => {
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 10 },
          { file: "b.ts", startLine: 1, endLine: 10 },
          { file: "c.ts", startLine: 1, endLine: 10 },
        ],
        10,
      ),
    ];

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.files).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(clusters[0]?.matchCount).toBe(1);
  });

  it("keeps a hub file's many unrelated pairings as separate small clusters, not one supercluster", () => {
    // hub.ts shares a different, unrelated block with each of 50 otherwise-disconnected files.
    // Union-find-style connected-component clustering would chain all 51 files into one cluster;
    // exact-file-set clustering must keep each pairing separate.
    const groups: DuplicateGroup[] = Array.from({ length: 50 }, (_, i) =>
      group(
        [
          { file: "hub.ts", startLine: i * 20, endLine: i * 20 + 9 },
          { file: `leaf${i}.ts`, startLine: 1, endLine: 10 },
        ],
        10,
      ),
    );

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(50);
    for (const cluster of clusters) {
      expect(cluster.files).toHaveLength(2);
      expect(cluster.files).toContain("hub.ts");
      expect(cluster.matchCount).toBe(1);
    }
  });

  it("returns an empty list for no groups", () => {
    expect(buildDuplicateClusters([])).toEqual([]);
  });

  it("computes per-file coverage, merging overlapping spans instead of summing them", () => {
    // Two overlapping matches in a.ts (lines 1-20 and 15-30) must count the shared 15-20 range
    // once, not twice.
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 20 },
          { file: "b.ts", startLine: 1, endLine: 20 },
        ],
        20,
      ),
      group(
        [
          { file: "a.ts", startLine: 15, endLine: 30 },
          { file: "b.ts", startLine: 15, endLine: 30 },
        ],
        16,
      ),
    ];

    const clusters = buildDuplicateClusters(groups, new Map([["a.ts", 100]]));

    expect(clusters).toHaveLength(1);
    const aCoverage = clusters[0]?.coverage.find((c) => c.file === "a.ts");
    expect(aCoverage?.coveredLines).toBe(30); // union of [1,20] and [15,30] = 30 lines, not 36
    expect(aCoverage?.totalLines).toBe(100);
    expect(aCoverage?.coveragePct).toBe(30);

    // No line count supplied for b.ts -> coveredLines still computed, pct left undefined.
    const bCoverage = clusters[0]?.coverage.find((c) => c.file === "b.ts");
    expect(bCoverage?.coveredLines).toBe(30);
    expect(bCoverage?.totalLines).toBeUndefined();
    expect(bCoverage?.coveragePct).toBeUndefined();
  });

  it("computes coverage with no fileLineCounts argument at all", () => {
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 10 },
          { file: "b.ts", startLine: 1, endLine: 10 },
        ],
        10,
      ),
    ];

    const clusters = buildDuplicateClusters(groups);
    expect(clusters[0]?.coverage.find((c) => c.file === "a.ts")?.coveredLines).toBe(10);
    expect(clusters[0]?.coverage.find((c) => c.file === "a.ts")?.totalLines).toBeUndefined();
  });

  it("handles a single-file (same-file self-overlap) group as a one-file cluster", () => {
    const groups: DuplicateGroup[] = [
      group(
        [
          { file: "a.ts", startLine: 1, endLine: 10 },
          { file: "a.ts", startLine: 100, endLine: 109 },
        ],
        10,
      ),
    ];

    const clusters = buildDuplicateClusters(groups);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.files).toEqual(["a.ts"]);
  });
});
