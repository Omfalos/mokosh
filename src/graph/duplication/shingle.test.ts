import { describe, expect, test } from "vitest";
import { findDuplicateGroups } from "./shingle";
import type { NormalizedToken } from "./tokenizer";

/** Builds a token stream from a whitespace-separated string, one token per line for simplicity. */
function tok(text: string, startLine = 1): NormalizedToken[] {
  return text.split(/\s+/).map((t, i) => ({ text: t, line: startLine + i }));
}

describe("findDuplicateGroups", () => {
  test("finds a cross-file duplicate block above minLines", () => {
    const shared = "a b c d e f g h i j k l m n o";
    const groups = findDuplicateGroups(
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

  test("chain-merges consecutive matching windows into one contiguous block", () => {
    const shared = "a b c d e f g h i j k l m n o p q r s t";
    const groups = findDuplicateGroups(
      [
        { file: "x.ts", tokens: tok(shared, 1) },
        { file: "y.ts", tokens: tok(shared, 1) },
      ],
      5,
      3,
    );
    // one merged block, not one group per shifted window position
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tokens).toBe(shared.split(" ").length);
  });

  test("respects minLines and drops short matches", () => {
    const shared = "a b c d e";
    const groups = findDuplicateGroups(
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
    const groups = findDuplicateGroups([{ file: "x.ts", tokens }], 5, 1);
    expect(groups).toHaveLength(0);
  });

  test("finds a within-file duplicate at two non-overlapping locations", () => {
    const block = "a b c d e f";
    const filler = "z z z z z z z z z z";
    const tokens = [...tok(block, 1), ...tok(filler, 10), ...tok(block, 30)];
    const groups = findDuplicateGroups([{ file: "x.ts", tokens }], 6, 3);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.occurrences.every((o) => o.file === "x.ts")).toBe(true);
  });

  test("returns no groups when nothing repeats", () => {
    const groups = findDuplicateGroups(
      [
        { file: "x.ts", tokens: tok("a b c d e f g h", 1) },
        { file: "y.ts", tokens: tok("1 2 3 4 5 6 7 8", 1) },
      ],
      5,
      1,
    );
    expect(groups).toHaveLength(0);
  });

  test("sorts groups largest-first", () => {
    const small = "a b c d e f g";
    const bigShared = "p q r s t u v w x y z 1 2 3 4 5 6 7 8 9";
    // Distinct, non-matching filler between the two shared blocks in each file prevents the
    // chain-merge from bridging them into a single block, so two separate groups are expected.
    const groups = findDuplicateGroups(
      [
        {
          file: "a.ts",
          tokens: [...tok(small, 1), ...tok("AAAA BBBB", 500), ...tok(bigShared, 1000)],
        },
        {
          file: "b.ts",
          tokens: [...tok(small, 1), ...tok("CCCC DDDD", 500), ...tok(bigShared, 2000)],
        },
      ],
      5,
      2,
    );
    expect(groups.length).toBeGreaterThan(1);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i - 1]?.lines).toBeGreaterThanOrEqual(groups[i]?.lines as number);
    }
  });

  test("clusters a block repeated across three files into one group instead of three pairs", () => {
    const shared = "a b c d e f g h i j k l m n o";
    const groups = findDuplicateGroups(
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

  // Regression test for a real bug: an earlier clustering implementation unioned any two
  // locations that pairwise chain-matched, transitively, and reported the *shortest* edge's
  // length for the whole component. A file that has one strong, long match plus a separate,
  // much shorter incidental match elsewhere got merged into one cluster and its long match was
  // silently reported as short. Clustering must only merge pair-matches that share an exact
  // occurrence (same file, same start/end line), so a strong match is never shortened by an
  // unrelated, weaker one that happens to touch a different part of the same file.
  test("does not shrink a strong match's length because the same file has a separate, shorter match elsewhere", () => {
    const longShared = "a b c d e f g h i j k l m n o p q r s t";
    const shortShared = "z z z z z";
    const groups = findDuplicateGroups(
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
    // Mimics normalized JSON-schema-shaped boilerplate: mostly { } : , [ ] with little else.
    // A uniform repeating unit so every shingle window (regardless of chain length or alignment)
    // has the same punctuation density, ruling out a shorter internal sub-window slipping under
    // the threshold even though the overall block is schema-shaped.
    const schemaShaped = Array.from({ length: 8 }, () => "{ ID : STR }").join(" ");
    const groups = findDuplicateGroups(
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
    const groups = findDuplicateGroups(
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
    const groups = findDuplicateGroups(
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
});
