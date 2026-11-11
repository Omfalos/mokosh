import { describe, expect, test } from "vitest";
import type { ScanCorpus } from "./corpus";
import { DUPLICATE_STRATEGIES } from "./strategies";

const emptyCorpus = (): ScanCorpus => ({
  structuralStyleFiles: [],
  jsLikeFiles: [],
  filesByFamily: new Map(),
  generatedPaths: new Set(),
  fileLineCounts: new Map(),
  sourceByFile: new Map(),
});

describe("DUPLICATE_STRATEGIES", () => {
  test("registers every strategy once, in the documented report order", () => {
    expect(DUPLICATE_STRATEGIES.map((s) => s.name)).toEqual([
      "style-blocks",
      "token-blocks",
      "style-vars",
      "type-defs",
      "object-literals",
      "jsx-elements",
    ]);
  });

  test("every strategy returns no groups for an empty corpus", () => {
    for (const strategy of DUPLICATE_STRATEGIES) {
      expect(
        strategy.run(emptyCorpus(), { minLines: 6, windowSize: 15, maxPunctuationRatio: 0.5 }),
      ).toEqual([]);
    }
  });

  test("the token strategy stamps each group with its language family", () => {
    const block = Array.from({ length: 40 }, (_, i) => ({
      text: `t${i % 7}`,
      line: i + 1,
      kind: "identifier" as const,
    }));
    const corpus = emptyCorpus();
    corpus.filesByFamily.set("js", [
      { file: "a.ts", tokens: block as never },
      { file: "b.ts", tokens: block as never },
    ]);
    const token = DUPLICATE_STRATEGIES.find((s) => s.name === "token-blocks");
    const groups = token?.run(corpus, { minLines: 1, windowSize: 5, maxPunctuationRatio: 1 }) ?? [];
    for (const group of groups) expect(group.family).toBe("js");
  });
});
