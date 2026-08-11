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

  test("agrees with the hash-shingle engine on which file pairs share a duplicate, on randomized multi-file input", () => {
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

      expect(pairsOf(exactGroups)).toEqual(pairsOf(hashGroups));
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
});
