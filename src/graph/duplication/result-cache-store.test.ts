import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuplicateCluster } from "./clusters";
import {
  type DuplicationResultParams,
  duplicationDigest,
  duplicationResultCacheKey,
  loadDuplicationResult,
  saveDuplicationResult,
} from "./result-cache-store";
import type { DuplicateGroup } from "./shingle";

const PARAMS: DuplicationResultParams = {
  minLines: 6,
  ignoreLiterals: true,
  maxPunctuationRatio: 0.5,
  limit: 500,
  scope: "src",
  includeGenerated: false,
  includeSameFile: false,
  includeSvgMarkup: false,
  includeDocs: false,
  ignoreDirs: ["dist", "node_modules"],
  ignoreGlobs: [],
};

const GROUPS: DuplicateGroup[] = [
  {
    occurrences: [
      { file: "a.ts", startLine: 1, endLine: 10 },
      { file: "b.ts", startLine: 1, endLine: 10 },
    ],
    lines: 10,
    tokens: 40,
  },
];
const CLUSTERS: DuplicateCluster[] = [
  {
    files: ["a.ts", "b.ts"],
    groups: GROUPS,
    matchCount: 1,
    longestMatch: 10,
    coverage: [],
  },
];

describe("duplicationResultCacheKey", () => {
  it("is stable regardless of array order and ignores unrelated key order", () => {
    const a = duplicationResultCacheKey({ ...PARAMS, ignoreDirs: ["node_modules", "dist"] });
    const b = duplicationResultCacheKey({ ...PARAMS, ignoreDirs: ["dist", "node_modules"] });
    expect(a).toBe(b);
  });

  it("changes when an output-affecting knob changes", () => {
    expect(duplicationResultCacheKey(PARAMS)).not.toBe(
      duplicationResultCacheKey({ ...PARAMS, scope: "all" }),
    );
    expect(duplicationResultCacheKey(PARAMS)).not.toBe(
      duplicationResultCacheKey({ ...PARAMS, limit: 20 }),
    );
  });
});

describe("duplicationDigest", () => {
  it("is order-independent over the node set and reacts to mtime/size", () => {
    const nodes = [
      { path: "a.ts", mtime: 1, size: 100 },
      { path: "b.ts", mtime: 2, size: 200 },
    ];
    expect(duplicationDigest(nodes)).toBe(duplicationDigest([...nodes].reverse()));
    expect(duplicationDigest(nodes)).not.toBe(
      duplicationDigest([{ path: "a.ts", mtime: 9, size: 100 }, nodes[1] as never]),
    );
  });
});

describe("load/save duplication result", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-dup-result-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips groups and clusters on a digest + params match", () => {
    const file = path.join(dir, "nested", "duplication-result.json");
    const key = duplicationResultCacheKey(PARAMS);
    saveDuplicationResult(file, "digest-1", key, GROUPS, CLUSTERS);

    const loaded = loadDuplicationResult(file, "digest-1", key);
    expect(loaded?.groups).toEqual(GROUPS);
    expect(loaded?.clusters).toEqual(CLUSTERS);
  });

  it("misses on a stale digest", () => {
    const file = path.join(dir, "duplication-result.json");
    const key = duplicationResultCacheKey(PARAMS);
    saveDuplicationResult(file, "digest-1", key, GROUPS, CLUSTERS);
    expect(loadDuplicationResult(file, "digest-2", key)).toBeNull();
  });

  it("misses on a different params key", () => {
    const file = path.join(dir, "duplication-result.json");
    saveDuplicationResult(file, "d", duplicationResultCacheKey(PARAMS), GROUPS, CLUSTERS);
    expect(
      loadDuplicationResult(file, "d", duplicationResultCacheKey({ ...PARAMS, minLines: 8 })),
    ).toBeNull();
  });

  it("returns null (never throws) for a missing or corrupt file", () => {
    const missing = path.join(dir, "nope.json");
    expect(loadDuplicationResult(missing, "d", "k")).toBeNull();

    const corrupt = path.join(dir, "corrupt.json");
    fs.writeFileSync(corrupt, "{not json");
    expect(loadDuplicationResult(corrupt, "d", "k")).toBeNull();
  });
});
