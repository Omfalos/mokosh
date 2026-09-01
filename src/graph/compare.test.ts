import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createImportMap } from "../index";
import { branchGraphCacheDir } from "./branch-graph-cache";
import {
  type BranchComparison,
  compareBranches,
  diffComplexity,
  diffCoverage,
  diffDocDrift,
  diffFiles,
  duplicateGroupSignature,
  findStaleReferences,
  summarizeBranchComparison,
} from "./compare";
import { Graph } from "./model";

function node(overrides: { path: string } & Record<string, unknown>) {
  return {
    type: "typescript" as const,
    category: "logic" as const,
    tags: [],
    imports: [],
    exports: [],
    mtime: 0,
    size: 0,
    ...overrides,
  };
}

describe("diffFiles", { tags: ["compare", "diffFiles"] }, () => {
  it("classifies added, removed, and changed files", () => {
    const base = Graph.deserialize({
      nodes: [
        node({ path: "src/a.ts", exports: [{ name: "foo" }] }),
        node({ path: "src/removed.ts" }),
      ],
    });
    const head = Graph.deserialize({
      nodes: [node({ path: "src/a.ts", exports: [{ name: "bar" }] }), node({ path: "src/new.ts" })],
    });

    expect(diffFiles(base, head)).toEqual({
      added: ["src/new.ts"],
      removed: ["src/removed.ts"],
      changed: ["src/a.ts"],
    });
  });

  it("does not flag a file whose imports/exports/category are unchanged", () => {
    const graph = Graph.deserialize({
      nodes: [node({ path: "src/a.ts", exports: [{ name: "foo" }] })],
    });
    expect(diffFiles(graph, graph).changed).toEqual([]);
  });
});

describe("findStaleReferences", { tags: ["compare", "findStaleReferences"] }, () => {
  it("flags an importer still naming a symbol removed from the target's exports", () => {
    const base = Graph.deserialize({
      nodes: [
        node({ path: "src/a.ts", exports: [{ name: "foo" }] }),
        node({
          path: "src/b.ts",
          imports: [
            {
              fromPath: "src/b.ts",
              toPath: "src/a.ts",
              rawSpecifier: "./a",
              isStyle: false,
              type: "static",
              symbols: ["foo"],
            },
          ],
        }),
      ],
    });
    const head = Graph.deserialize({
      nodes: [
        node({ path: "src/a.ts", exports: [{ name: "bar" }] }),
        node({
          path: "src/b.ts",
          imports: [
            {
              fromPath: "src/b.ts",
              toPath: "src/a.ts",
              rawSpecifier: "./a",
              isStyle: false,
              type: "static",
              symbols: ["foo"],
            },
          ],
        }),
      ],
    });

    expect(findStaleReferences(base, head)).toEqual([
      { file: "src/a.ts", symbol: "foo", stillReferencedBy: ["src/b.ts"] },
    ]);
  });

  it("does not flag a removed export with no remaining importer", () => {
    const base = Graph.deserialize({
      nodes: [node({ path: "src/a.ts", exports: [{ name: "foo" }] })],
    });
    const head = Graph.deserialize({
      nodes: [node({ path: "src/a.ts", exports: [] })],
    });
    expect(findStaleReferences(base, head)).toEqual([]);
  });

  it("does not flag an importer that was updated to the new symbol", () => {
    const base = Graph.deserialize({
      nodes: [
        node({ path: "src/a.ts", exports: [{ name: "foo" }] }),
        node({
          path: "src/b.ts",
          imports: [
            {
              fromPath: "src/b.ts",
              toPath: "src/a.ts",
              rawSpecifier: "./a",
              isStyle: false,
              type: "static",
              symbols: ["foo"],
            },
          ],
        }),
      ],
    });
    const head = Graph.deserialize({
      nodes: [
        node({ path: "src/a.ts", exports: [{ name: "bar" }] }),
        node({
          path: "src/b.ts",
          imports: [
            {
              fromPath: "src/b.ts",
              toPath: "src/a.ts",
              rawSpecifier: "./a",
              isStyle: false,
              type: "static",
              symbols: ["bar"],
            },
          ],
        }),
      ],
    });
    expect(findStaleReferences(base, head)).toEqual([]);
  });
});

describe("diffComplexity", { tags: ["compare", "diffComplexity"] }, () => {
  it("reports new and resolved hotspots plus average score per side", () => {
    const base = Graph.deserialize({
      nodes: [
        node({
          path: "src/a.ts",
          cognitiveComplexity: 20,
          functions: [{ name: "old", line: 1, complexity: 15, cognitiveComplexity: 15 }],
        }),
      ],
    });
    const head = Graph.deserialize({
      nodes: [
        node({
          path: "src/a.ts",
          cognitiveComplexity: 4,
          functions: [{ name: "old", line: 1, complexity: 1, cognitiveComplexity: 1 }],
        }),
        node({
          path: "src/b.ts",
          cognitiveComplexity: 30,
          functions: [{ name: "risky", line: 1, complexity: 30, cognitiveComplexity: 30 }],
        }),
      ],
    });

    const delta = diffComplexity(base, head, undefined, 10);
    expect(delta.newHotspots).toEqual([
      { file: "src/b.ts", name: "risky", line: 1, complexity: 30, cognitiveComplexity: 30 },
    ]);
    expect(delta.resolvedHotspots).toEqual([
      { file: "src/a.ts", name: "old", line: 1, complexity: 15, cognitiveComplexity: 15 },
    ]);
    expect(delta.base.avgCognitiveComplexity).toBe(20);
    expect(delta.head.avgCognitiveComplexity).toBe(17);
  });
});

describe("diffDocDrift", { tags: ["compare", "diffDocDrift"] }, () => {
  it("reports newly stale and resolved doc references", () => {
    const base = Graph.deserialize({
      nodes: [node({ path: "docs/a.md", type: "markdown", staleFor: ["src/old.ts"] })],
    });
    const head = Graph.deserialize({
      nodes: [node({ path: "docs/a.md", type: "markdown", staleFor: ["src/new.ts"] })],
    });

    const delta = diffDocDrift(base, head);
    expect(delta.newlyStale).toEqual(["docs/a.md::src/new.ts"]);
    expect(delta.resolved).toEqual(["docs/a.md::src/old.ts"]);
  });
});

describe("diffCoverage", { tags: ["compare", "diffCoverage"] }, () => {
  it("returns null when either side lacks coverage data", () => {
    const withCoverage = Graph.deserialize({
      nodes: [node({ path: "src/a.ts", coveragePct: 40 })],
    });
    const withoutCoverage = Graph.deserialize({ nodes: [node({ path: "src/a.ts" })] });
    expect(diffCoverage(withCoverage, withoutCoverage, undefined)).toBeNull();
  });

  it("diffs risk hotspots and average coverage when both sides have data", () => {
    const base = Graph.deserialize({
      nodes: [
        node({
          path: "src/a.ts",
          coveragePct: 20,
          functions: [{ name: "risky", line: 1, complexity: 20, cognitiveComplexity: 20 }],
        }),
      ],
    });
    const head = Graph.deserialize({
      nodes: [
        node({
          path: "src/a.ts",
          coveragePct: 90,
          functions: [{ name: "risky", line: 1, complexity: 20, cognitiveComplexity: 20 }],
        }),
      ],
    });
    const delta = diffCoverage(base, head, undefined);
    expect(delta).not.toBeNull();
    expect(delta?.resolvedHotspots).toHaveLength(1);
    expect(delta?.newHotspots).toHaveLength(0);
  });
});

describe("duplicateGroupSignature", { tags: ["compare", "duplicateGroupSignature"] }, () => {
  it("is stable regardless of occurrence order", () => {
    const a = {
      occurrences: [
        { file: "src/a.ts", startLine: 1, endLine: 5 },
        { file: "src/b.ts", startLine: 10, endLine: 14 },
      ],
      lines: 5,
      tokens: 20,
      family: "code" as const,
    };
    const b = {
      ...a,
      occurrences: [...a.occurrences].reverse(),
    };
    expect(duplicateGroupSignature(a)).toBe(duplicateGroupSignature(b));
  });
});

describe("buildGraphAtRef / compareBranches (real git worktree)", {
  tags: ["compare", "compareBranches", "worktree-integration"],
}, () => {
  let repoDir: string | undefined;

  afterEach(() => {
    if (repoDir) fs.rmSync(repoDir, { recursive: true, force: true });
    repoDir = undefined;
  });

  it("builds the base ref via a worktree, caches it by sha, and flags a stale reference", async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-compare-test-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repoDir, stdio: ["ignore", "pipe", "pipe"] });

    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");

    fs.mkdirSync(path.join(repoDir, "src"));
    fs.writeFileSync(path.join(repoDir, "src", "a.ts"), "export function foo() { return 1; }\n");
    fs.writeFileSync(path.join(repoDir, "src", "b.ts"), "import { foo } from './a';\nfoo();\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();

    // Head: renamed the export but "forgot" to update b.ts's import — the bug this exists to catch.
    fs.writeFileSync(path.join(repoDir, "src", "a.ts"), "export function bar() { return 1; }\n");
    git("add", ".");
    git("commit", "-q", "-m", "head");

    const headGraph = await createImportMap(repoDir, ["src/b.ts"], null, { silent: true });

    const comparison = await compareBranches(repoDir as string, baseSha, headGraph, {
      entryPoints: ["src/b.ts"],
      silent: true,
    });

    expect(comparison.base.sha).toBe(baseSha);
    expect(comparison.files.changed).toContain("src/a.ts");
    expect(comparison.staleReferences).toEqual([
      { file: "src/a.ts", symbol: "foo", stillReferencedBy: ["src/b.ts"] },
    ]);

    // Second call for the same base sha should hit the disk cache instead of re-checking out a worktree.
    const cachedFile = path.join(branchGraphCacheDir(repoDir as string), `${baseSha}.json`);
    expect(fs.existsSync(cachedFile)).toBe(true);

    const second = await compareBranches(repoDir as string, baseSha, headGraph, {
      entryPoints: ["src/b.ts"],
      silent: true,
    });
    expect(second.base.sha).toBe(baseSha);
  }, 30000);
});

describe("summarizeBranchComparison", { tags: ["compare", "summarizeBranchComparison"] }, () => {
  const emptyComparison = (): BranchComparison => ({
    base: { ref: "main", sha: "9263c98c79c53a613849bd75353b499a8ac5ff75" },
    head: { ref: "HEAD", sha: "a5be5106b5d65afd4f95496da1b8dff9c091299d" },
    files: { added: [], removed: [], changed: [] },
    staleReferences: [],
    duplication: { base: { groups: 50 }, head: { groups: 50 }, newGroups: [], resolvedGroups: [] },
    complexity: {
      base: { avgCognitiveComplexity: 10 },
      head: { avgCognitiveComplexity: 10 },
      newHotspots: [],
      resolvedHotspots: [],
    },
    docDrift: { base: { staleCount: 0 }, head: { staleCount: 0 }, newlyStale: [], resolved: [] },
    coverage: null,
  });

  const hotspot = (name: string, cognitive: number) => ({
    file: `src/${name}.ts`,
    name,
    line: 12,
    complexity: 5,
    cognitiveComplexity: cognitive,
  });

  it("reports a clean verdict with short refs and no delta sections", () => {
    const summary = summarizeBranchComparison(emptyComparison());
    expect(summary.base).toBe("main@9263c98c");
    expect(summary.head).toBe("HEAD@a5be5106");
    expect(summary.verdict).toBe("clean");
    expect(summary.files).toEqual({
      added: 0,
      changed: 0,
      removed: 0,
      paths: { added: [], changed: [], removed: [] },
    });
    expect(summary.complexity).toBeUndefined();
    expect(summary.duplication).toBeUndefined();
    expect(summary.docDrift).toBeUndefined();
    expect(summary.staleReferences).toBeUndefined();
  });

  it("caps new complexity hotspots at maxItems but keeps the true count", () => {
    const comparison = emptyComparison();
    comparison.files.changed = ["src/a.ts"];
    comparison.complexity.newHotspots = [
      hotspot("worst", 40),
      hotspot("bad", 30),
      hotspot("meh", 20),
    ];
    comparison.complexity.head.avgCognitiveComplexity = 12.5;

    const summary = summarizeBranchComparison(comparison, { maxItems: 2 });
    expect(summary.verdict).toBe("review-worthy");
    expect(summary.complexity).toEqual({
      avgDelta: 2.5,
      newHotspots: ["src/worst.ts:12 worst (40)", "src/bad.ts:12 bad (30)"],
      newHotspotCount: 3,
      resolvedCount: 0,
    });
    expect(summary.headline).toContain(
      "+3 complexity hotspots (max cognitiveComplexity 40 in src/worst.ts)",
    );
  });

  it("collapses resolved hotspots to a bare count", () => {
    const comparison = emptyComparison();
    comparison.complexity.resolvedHotspots = [hotspot("fixed", 25), hotspot("also", 15)];
    const summary = summarizeBranchComparison(comparison);
    expect(summary.complexity).toEqual({
      avgDelta: 0,
      newHotspots: [],
      newHotspotCount: 0,
      resolvedCount: 2,
    });
    expect(summary.verdict).toBe("clean");
  });

  it("uses the `complexity` metric for the per-entry score when asked", () => {
    const comparison = emptyComparison();
    comparison.complexity.newHotspots = [hotspot("x", 40)];
    const summary = summarizeBranchComparison(comparison, { metric: "complexity" });
    expect(summary.complexity?.newHotspots).toEqual(["src/x.ts:12 x (5)"]);
  });

  it("escalates to attention and never truncates stale references", () => {
    const comparison = emptyComparison();
    comparison.staleReferences = [
      { file: "src/a.ts", symbol: "foo", stillReferencedBy: ["src/b.ts", "src/c.ts"] },
      { file: "src/d.ts", symbol: "bar", stillReferencedBy: ["src/e.ts"] },
    ];
    const summary = summarizeBranchComparison(comparison, { maxItems: 1 });
    expect(summary.verdict).toBe("attention");
    expect(summary.staleReferences).toHaveLength(2);
    expect(summary.headline).toContain("⚠ 2 stale references — removed export still imported");
  });

  it("drops file path lists when the diff is larger than maxPathList", () => {
    const comparison = emptyComparison();
    comparison.files.changed = Array.from({ length: 30 }, (_, i) => `src/file${i}.ts`);
    const summary = summarizeBranchComparison(comparison, { maxPathList: 10 });
    expect(summary.files.changed).toBe(30);
    expect(summary.files.paths).toBeUndefined();
  });

  it("formats duplication groups compactly and reports the head group total", () => {
    const comparison = emptyComparison();
    comparison.duplication.head.groups = 52;
    comparison.duplication.newGroups = [
      {
        occurrences: [
          { file: "src/a.ts", startLine: 1, endLine: 12 },
          { file: "src/b.ts", startLine: 40, endLine: 51 },
        ],
        lines: 12,
        tokens: 80,
      },
    ];
    const summary = summarizeBranchComparison(comparison);
    expect(summary.duplication).toEqual({
      newGroups: ["12L x2: src/a.ts:1-12, src/b.ts:40-51"],
      newGroupCount: 1,
      resolvedCount: 0,
      totalGroups: 52,
    });
  });

  it("rewrites doc-drift entries as `doc → referencedFile`", () => {
    const comparison = emptyComparison();
    comparison.docDrift.newlyStale = ["docs/guide.md::src/server.ts"];
    comparison.docDrift.resolved = ["CLAUDE.md::src/parser.ts", "CLAUDE.md::src/cli/runner.ts"];
    const summary = summarizeBranchComparison(comparison);
    expect(summary.docDrift).toEqual({
      newlyStale: ["docs/guide.md → src/server.ts"],
      newlyStaleCount: 1,
      resolvedCount: 2,
    });
  });
});
