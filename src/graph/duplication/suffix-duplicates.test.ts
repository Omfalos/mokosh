import { describe, expect, test } from "vitest";
import { findDuplicateGroups } from "./shingle";
import { findExactDuplicateGroups } from "./suffix-duplicates";
import type { NormalizedToken } from "./tokenizer";

/** Builds a token stream from a whitespace-separated string, one token per line for simplicity. */
function tok(text: string, startLine = 1): NormalizedToken[] {
  return text.split(/\s+/).map((t, i) => ({ text: t, line: startLine + i }));
}

describe("findExactDuplicateGroups", () => {
  test("finds a cross-file duplicate block above minLines", () => {
    const shared = "a b c d e f g h i j k l m n o";
    const groups = findExactDuplicateGroups(
      [
        { file: "x.ts", tokens: tok(shared, 1) },
        { file: "y.ts", tokens: tok(shared, 100) },
      ],
      5,
      3,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences.map((o) => o.file).sort()).toEqual(["x.ts", "y.ts"]);
  });

  test("reports the exact full match length, not just the windowSize threshold", () => {
    const shared = "a b c d e f g h i j k l m n o p q r s t";
    const groups = findExactDuplicateGroups(
      [
        { file: "x.ts", tokens: tok(shared, 1) },
        { file: "y.ts", tokens: tok(shared, 1) },
      ],
      5,
      3,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tokens).toBe(shared.split(" ").length);
  });

  test("respects minLines and drops short matches", () => {
    const shared = "a b c d e";
    const groups = findExactDuplicateGroups(
      [
        { file: "x.ts", tokens: tok(shared, 1) },
        { file: "y.ts", tokens: tok(shared, 1) },
      ],
      5,
      10,
    );
    expect(groups).toHaveLength(0);
  });

  test("does not report a same-file self-overlapping match", () => {
    const tokens = tok("a b c d e", 1);
    const groups = findExactDuplicateGroups([{ file: "x.ts", tokens }], 5, 1);
    expect(groups).toHaveLength(0);
  });

  test("finds a within-file duplicate at two non-overlapping locations", () => {
    const block = "a b c d e f";
    const filler = "z z z z z z z z z z";
    const tokens = [...tok(block, 1), ...tok(filler, 10), ...tok(block, 30)];
    const groups = findExactDuplicateGroups([{ file: "x.ts", tokens }], 6, 3);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences.every((o) => o.file === "x.ts")).toBe(true);
  });

  test("returns no groups when nothing repeats", () => {
    const groups = findExactDuplicateGroups(
      [
        { file: "x.ts", tokens: tok("a b c d e f g h", 1) },
        { file: "y.ts", tokens: tok("1 2 3 4 5 6 7 8", 1) },
      ],
      5,
      1,
    );
    expect(groups).toHaveLength(0);
  });

  test("clusters a block repeated across three files into one group instead of three pairs", () => {
    const shared = "a b c d e f g h i j k l m n o";
    const groups = findExactDuplicateGroups(
      [
        { file: "x.ts", tokens: tok(shared, 1) },
        { file: "y.ts", tokens: tok(shared, 100) },
        { file: "z.ts", tokens: tok(shared, 200) },
      ],
      5,
      3,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences.map((o) => o.file).sort()).toEqual(["x.ts", "y.ts", "z.ts"]);
  });

  test("reports a strong long match at its full length even when the same file has a separate, shorter match elsewhere", () => {
    const longShared = "a b c d e f g h i j k l m n o p q r s t";
    const shortShared = "z z z z z";
    const groups = findExactDuplicateGroups(
      [
        {
          file: "x.ts",
          tokens: [...tok(longShared, 1), ...tok("FILLER FILLER", 100), ...tok(shortShared, 200)],
        },
        { file: "y.ts", tokens: tok(longShared, 1) },
        { file: "w.ts", tokens: tok(shortShared, 1) },
      ],
      5,
      3,
    );
    const xy = groups.find(
      (g) =>
        g.occurrences.some((o) => o.file === "x.ts") &&
        g.occurrences.some((o) => o.file === "y.ts"),
    );
    expect(xy?.lines).toBe(longShared.split(" ").length);
  });

  test("gates out a block dominated by object/array-literal structural punctuation", () => {
    const schemaShaped = Array.from({ length: 8 }, () => "{ ID : STR }").join(" ");
    const groups = findExactDuplicateGroups(
      [
        { file: "a.ts", tokens: tok(schemaShaped, 1) },
        { file: "b.ts", tokens: tok(schemaShaped, 1) },
      ],
      5,
      3,
    );
    expect(groups).toHaveLength(0);
  });

  test("does not gate a block with normal keyword/operator density even when repetitive", () => {
    const block = "function ID ( ID ) { let ID = NUM ; return ID + ID ; }";
    const groups = findExactDuplicateGroups(
      [
        { file: "a.ts", tokens: tok(block, 1) },
        { file: "b.ts", tokens: tok(block, 1) },
      ],
      5,
      3,
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  test("maxPunctuationRatio: 1 disables the structural-punctuation gate", () => {
    const schemaShaped = "ID : { ID : ID , ID : ID , ID : ID , ID : ID , ID : ID }";
    const groups = findExactDuplicateGroups(
      [
        { file: "a.ts", tokens: tok(schemaShaped, 1) },
        { file: "b.ts", tokens: tok(schemaShaped, 1) },
      ],
      5,
      3,
      1,
    );
    expect(groups.length).toBeGreaterThan(0);
  });

  test("handles no files / all-empty token streams", () => {
    expect(findExactDuplicateGroups([], 5, 3)).toEqual([]);
    expect(findExactDuplicateGroups([{ file: "x.ts", tokens: [] }], 5, 3)).toEqual([]);
  });

  test("every reported file pair also shares a duplicate per the hash-shingle engine, on randomized multi-file input", () => {
    const alphabet = ["a", "b", "c", "d"];
    for (let trial = 0; trial < 30; trial++) {
      const fileCount = 2 + Math.floor(Math.random() * 3);
      const files = Array.from({ length: fileCount }, (_, i) => {
        const length = 5 + Math.floor(Math.random() * 15);
        const text = Array.from(
          { length },
          () => alphabet[Math.floor(Math.random() * alphabet.length)] as string,
        ).join(" ");
        return { file: `f${i}.ts`, tokens: tok(text, 1) };
      });
      const windowSize = 3;
      const minLines = 1;

      const exactGroups = findExactDuplicateGroups(
        files.map((f) => ({ file: f.file, tokens: f.tokens })),
        windowSize,
        minLines,
        1,
      );
      const { groups: hashGroups } = findDuplicateGroups(
        files.map((f) => ({ file: f.file, tokens: f.tokens })),
        windowSize,
        minLines,
        1,
        Number.POSITIVE_INFINITY,
      );

      const pairKey = (a: string, b: string) => [a, b].sort().join("~");
      const pairsOf = (groups: { occurrences: { file: string }[] }[]) => {
        const pairs = new Set<string>();
        for (const g of groups) {
          const files = [...new Set(g.occurrences.map((o) => o.file))];
          for (let i = 0; i < files.length; i++) {
            for (let j = i + 1; j < files.length; j++) {
              pairs.add(pairKey(files[i] as string, files[j] as string));
            }
          }
        }
        return pairs;
      };

      // Not exact equality: `applyDominanceFilter`'s per-occurrence trimming (see its doc
      // comment in suffix-duplicates.ts) is a deliberately lossy heuristic that can drop a
      // real pairing in a narrow case (an occurrence spatially subsumed by an unrelated,
      // longer match elsewhere), so `exactGroups` is only ever a subset of `hashGroups` now,
      // never a superset (the filter only ever removes occurrences, never invents matches).
      for (const pair of pairsOf(exactGroups)) {
        expect(pairsOf(hashGroups).has(pair)).toBe(true);
      }
    }
  });

  test("a block repeated four times reports one group with four occurrences, not six pairs", () => {
    const shared = "a b c d e f g h i j k l m n o";
    const groups = findExactDuplicateGroups(
      [
        { file: "a.ts", tokens: tok(shared, 1) },
        { file: "b.ts", tokens: tok(shared, 1) },
        { file: "c.ts", tokens: tok(shared, 1) },
        { file: "d.ts", tokens: tok(shared, 1) },
      ],
      5,
      3,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences).toHaveLength(4);
  });

  describe("applyDominanceFilter (clone-family consolidation)", () => {
    test("a shorter match fully subsumed by a longer one at the same position is dropped, not reported twice", () => {
      // a.ts and b.ts share a 20-token run; c.ts only shares the first 10 tokens of it (same
      // starting position, diverges after). Without consolidation this is two groups: {a,b,c} at
      // 10 tokens and {a,b} at 20 — the "same shape, one row per variant" noise from
      // docs/known_issues/09-duplicate-clone-family-noise.md. Only the longer, more specific
      // group should survive; c's contribution is the documented, accepted trade-off (see
      // applyDominanceFilter's doc comment) — it's no longer reported on its own.
      const common = "a b c d e f g h i j";
      const extra = "k l m n o p q r s t";
      const groups = findExactDuplicateGroups(
        [
          { file: "a.ts", tokens: tok(`${common} ${extra}`, 1) },
          { file: "b.ts", tokens: tok(`${common} ${extra}`, 1) },
          { file: "c.ts", tokens: tok(common, 1) },
        ],
        5,
        1,
        1,
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]?.tokens).toBe(20);
      expect(groups[0]?.occurrences.map((o) => o.file).sort()).toEqual(["a.ts", "b.ts"]);
    });

    test("same-file repeats that partially extend together collapse to the longer match instead of reporting both", () => {
      // One file has a 10-token "common" pattern that repeats (as part of a 20-token run) at two
      // positions, plus a third position where it's followed by different content. Before
      // consolidation this is two groups: the 10-token common-prefix one (all three positions)
      // and the 20-token one (just the first two). After: only the more specific 20-token one —
      // the third position's now-unpaired 10-token overlap is the documented trade-off. This is
      // the same "same shape, shifted offsets" self-overlap noise the peer dogfooding session
      // reported against Feed.js.
      const common = "a b c d e f g h i j";
      const extra = "k l m n o p q r s t";
      const diverges = "z1 z2 z3 z4 z5 z6 z7 z8 z9 z10";
      const filler1 = "F1a F1b F1c F1d F1e F1f F1g F1h F1i F1j";
      const filler2 = "F2a F2b F2c F2d F2e F2f F2g F2h F2i F2j";
      const tokens = [
        ...tok(`${common} ${extra}`, 1),
        ...tok(filler1, 100),
        ...tok(`${common} ${extra}`, 200),
        ...tok(filler2, 300),
        ...tok(`${common} ${diverges}`, 400),
      ];
      const groups = findExactDuplicateGroups([{ file: "x.ts", tokens }], 5, 1, 1);

      expect(groups).toHaveLength(1);
      expect(groups[0]?.tokens).toBe(20);
      expect(groups[0]?.occurrences).toHaveLength(2);
    });

    test("two genuinely separate matches (no containment either way) are both kept, not merged", () => {
      // Two shared blocks in each file, separated by filler that differs per file (so the two
      // blocks can never merge into one longer run) — neither match's span contains the other's,
      // so both must survive.
      const blockA = "a b c d e f g h i j";
      const blockB = "1 2 3 4 5 6 7 8 9 0";
      const tokensOf = (fillerText: string) => [
        ...tok(blockA, 1),
        ...tok(fillerText, 20),
        ...tok(blockB, 40),
      ];

      const groups = findExactDuplicateGroups(
        [
          { file: "x.ts", tokens: tokensOf("Fx1 Fx2 Fx3 Fx4 Fx5 Fx6 Fx7 Fx8 Fx9 Fx10") },
          { file: "y.ts", tokens: tokensOf("Fy1 Fy2 Fy3 Fy4 Fy5 Fy6 Fy7 Fy8 Fy9 Fy10") },
        ],
        5,
        1,
        1,
      );

      expect(groups).toHaveLength(2);
      const tokenLengths = groups.map((g) => g.tokens).sort((a, b) => a - b);
      expect(tokenLengths).toEqual([10, 10]);
    });
  });
});
