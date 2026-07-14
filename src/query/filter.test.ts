import { describe, expect, test } from "vitest";
import type { SerializedGraph } from "../types/graph";
import type { FileNode, ImportEdge } from "../types/node";
import { filterGraph, matchNode } from "./filter";

// ── factories ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<FileNode> & { path: string }): FileNode {
  return {
    type: "typescript",
    category: "logic",
    tags: [],
    imports: [],
    exports: [],
    mtime: 0,
    size: 0,
    ...overrides,
  };
}

function makeImport(toPath: string, isExternal = false): ImportEdge {
  return {
    fromPath: "src/a.ts",
    toPath,
    isStyle: false,
    rawSpecifier: toPath,
    type: "static",
    isExternal,
  };
}

function tag(name: string) {
  return { name, kind: "comment-marker" as const };
}

// ── matchNode ────────────────────────────────────────────────────────────────

describe("matchNode", {
  tags: [
    "FileNode",
    "ImportEdge",
    "SerializedGraph",
    "filter",
    "filterGraph",
    "graph",
    "matchNode",
    "node",
  ],
}, () => {
  const base = makeNode({ path: "src/a.ts" });

  describe("category", () => {
    test("matches exact value", () => {
      expect(matchNode({ ...base, category: "logic" }, { category: "logic" })).toBe(true);
    });

    test("rejects different value", () => {
      expect(matchNode({ ...base, category: "ui" }, { category: "logic" })).toBe(false);
    });

    test("negated: passes when value differs", () => {
      expect(matchNode({ ...base, category: "ui" }, { category: "!logic" })).toBe(true);
    });

    test("negated: fails when value matches negated term", () => {
      expect(matchNode({ ...base, category: "logic" }, { category: "!logic" })).toBe(false);
    });

    test("skipped when not in query", () => {
      expect(matchNode({ ...base, category: "other" }, {})).toBe(true);
    });
  });

  describe("type", () => {
    test("matches exact value", () => {
      expect(matchNode({ ...base, type: "typescript" }, { type: "typescript" })).toBe(true);
    });

    test("rejects different value", () => {
      expect(matchNode({ ...base, type: "lua" }, { type: "typescript" })).toBe(false);
    });

    test("negated: passes when different", () => {
      expect(matchNode({ ...base, type: "lua" }, { type: "!typescript" })).toBe(true);
    });

    test("negated: fails when matching negated term", () => {
      expect(matchNode({ ...base, type: "typescript" }, { type: "!typescript" })).toBe(false);
    });
  });

  describe("path", () => {
    test("matches substring", () => {
      expect(matchNode({ ...base, path: "src/auth/service.ts" }, { path: "auth" })).toBe(true);
    });

    test("rejects non-matching substring", () => {
      expect(matchNode({ ...base, path: "src/ui.ts" }, { path: "auth" })).toBe(false);
    });

    test("negated: passes when path does not contain substring", () => {
      expect(matchNode({ ...base, path: "src/ui.ts" }, { path: "!auth" })).toBe(true);
    });

    test("negated: fails when path contains negated substring", () => {
      expect(matchNode({ ...base, path: "src/auth/service.ts" }, { path: "!auth" })).toBe(false);
    });
  });

  describe("isExternal", () => {
    const withExternal = makeNode({
      path: "src/a.ts",
      imports: [makeImport("react", true)],
    });
    const withoutExternal = makeNode({
      path: "src/a.ts",
      imports: [makeImport("src/b.ts", false)],
    });
    const noImports = makeNode({ path: "src/a.ts" });

    test("node with external import passes isExternal:true", () => {
      expect(matchNode(withExternal, { isExternal: true })).toBe(true);
    });

    test("node with external import fails isExternal:false", () => {
      expect(matchNode(withExternal, { isExternal: false })).toBe(false);
    });

    test("node without external import passes isExternal:false", () => {
      expect(matchNode(withoutExternal, { isExternal: false })).toBe(true);
    });

    test("node without external import fails isExternal:true", () => {
      expect(matchNode(noImports, { isExternal: true })).toBe(false);
    });

    test("skipped when isExternal not in query", () => {
      expect(matchNode(withExternal, {})).toBe(true);
    });
  });

  describe("tags — OR logic", () => {
    const node = makeNode({ path: "src/a.ts", tags: [tag("auth"), tag("core")] });

    test("passes when at least one positive tag is present", () => {
      expect(matchNode(node, { tags: ["auth", "payments"] })).toBe(true);
    });

    test("fails when no positive tag matches", () => {
      expect(matchNode(node, { tags: ["payments", "billing"] })).toBe(false);
    });

    test("only negated tags: passes when none are present", () => {
      expect(matchNode(node, { tags: ["!internal"] })).toBe(true);
    });

    test("only negated tags: fails when a negated tag is present", () => {
      expect(matchNode(node, { tags: ["!auth"] })).toBe(false);
    });

    test("mixed: positive matches and negative not present → passes", () => {
      expect(matchNode(node, { tags: ["auth", "!internal"] })).toBe(true);
    });

    test("mixed: positive matches but negative also present → fails", () => {
      expect(matchNode(node, { tags: ["auth", "!core"] })).toBe(false);
    });

    test("empty tags array skips the check entirely", () => {
      expect(matchNode(makeNode({ path: "src/a.ts" }), { tags: [] })).toBe(true);
    });

    test("skipped when tags not in query", () => {
      expect(matchNode(node, {})).toBe(true);
    });
  });

  describe("allTags — AND logic", () => {
    const node = makeNode({ path: "src/a.ts", tags: [tag("auth"), tag("core")] });

    test("passes when all required tags are present", () => {
      expect(matchNode(node, { allTags: ["auth", "core"] })).toBe(true);
    });

    test("fails when one required tag is missing", () => {
      expect(matchNode(node, { allTags: ["auth", "payments"] })).toBe(false);
    });

    test("empty allTags skips the check", () => {
      expect(matchNode(makeNode({ path: "src/a.ts" }), { allTags: [] })).toBe(true);
    });

    test("skipped when allTags not in query", () => {
      expect(matchNode(node, {})).toBe(true);
    });
  });

  describe("importsFile", () => {
    const node = makeNode({
      path: "src/a.ts",
      imports: [makeImport("src/db/connection.ts"), makeImport("src/util.ts")],
    });

    test("passes when an import toPath contains the substring", () => {
      expect(matchNode(node, { importsFile: "db" })).toBe(true);
    });

    test("fails when no import matches the substring", () => {
      expect(matchNode(node, { importsFile: "auth" })).toBe(false);
    });

    test("fails when node has no imports", () => {
      expect(matchNode(makeNode({ path: "src/a.ts" }), { importsFile: "db" })).toBe(false);
    });

    test("skipped when importsFile not in query", () => {
      expect(matchNode(node, {})).toBe(true);
    });
  });

  describe("importedBy", () => {
    const node = makeNode({ path: "src/db.ts" });
    const reverseIndex = new Map([["src/db.ts", ["src/service.ts", "src/repo.ts"]]]);

    test("passes when an importer path contains the substring", () => {
      expect(matchNode(node, { importedBy: "service" }, reverseIndex)).toBe(true);
    });

    test("fails when no importer path matches the substring", () => {
      expect(matchNode(node, { importedBy: "controller" }, reverseIndex)).toBe(false);
    });

    test("fails when reverseIndex has no entry for this node", () => {
      expect(matchNode(node, { importedBy: "service" }, new Map())).toBe(false);
    });

    test("fails when no reverseIndex is provided", () => {
      expect(matchNode(node, { importedBy: "service" })).toBe(false);
    });

    test("skipped when importedBy not in query", () => {
      expect(matchNode(node, {})).toBe(true);
    });
  });

  describe("minImports / maxImports", () => {
    const node = makeNode({
      path: "src/a.ts",
      imports: [makeImport("src/b.ts"), makeImport("src/c.ts")],
    });

    test("minImports: passes when count equals threshold", () => {
      expect(matchNode(node, { minImports: 2 })).toBe(true);
    });

    test("minImports: passes when count exceeds threshold", () => {
      expect(matchNode(node, { minImports: 1 })).toBe(true);
    });

    test("minImports: fails when count is below threshold", () => {
      expect(matchNode(node, { minImports: 3 })).toBe(false);
    });

    test("maxImports: passes when count equals threshold", () => {
      expect(matchNode(node, { maxImports: 2 })).toBe(true);
    });

    test("maxImports: passes when count is below threshold", () => {
      expect(matchNode(node, { maxImports: 5 })).toBe(true);
    });

    test("maxImports: fails when count exceeds threshold", () => {
      expect(matchNode(node, { maxImports: 1 })).toBe(false);
    });

    test("both: passes when count is within range", () => {
      expect(matchNode(node, { minImports: 1, maxImports: 3 })).toBe(true);
    });
  });

  describe("minSize / maxSize", () => {
    const node = makeNode({ path: "src/a.ts", size: 1000 });

    test("minSize: passes when size equals threshold", () => {
      expect(matchNode(node, { minSize: 1000 })).toBe(true);
    });

    test("minSize: fails when size is below threshold", () => {
      expect(matchNode(node, { minSize: 1001 })).toBe(false);
    });

    test("maxSize: passes when size equals threshold", () => {
      expect(matchNode(node, { maxSize: 1000 })).toBe(true);
    });

    test("maxSize: fails when size exceeds threshold", () => {
      expect(matchNode(node, { maxSize: 999 })).toBe(false);
    });
  });

  describe("hasDocstring", () => {
    const withDoc = makeNode({ path: "src/a.ts", description: "Does something." });
    const noDoc = makeNode({ path: "src/a.ts" });

    test("passes when node has description and query is true", () => {
      expect(matchNode(withDoc, { hasDocstring: true })).toBe(true);
    });

    test("fails when node has no description and query is true", () => {
      expect(matchNode(noDoc, { hasDocstring: true })).toBe(false);
    });

    test("fails when node has description and query is false", () => {
      expect(matchNode(withDoc, { hasDocstring: false })).toBe(false);
    });

    test("passes when node has no description and query is false", () => {
      expect(matchNode(noDoc, { hasDocstring: false })).toBe(true);
    });

    test("skipped when hasDocstring not in query", () => {
      expect(matchNode(noDoc, {})).toBe(true);
    });
  });

  describe("minComplexity / maxComplexity", () => {
    const node = makeNode({ path: "src/a.ts", complexity: 10 });
    const noData = makeNode({ path: "src/b.ts" });

    test("minComplexity: passes when at or above threshold", () => {
      expect(matchNode(node, { minComplexity: 10 })).toBe(true);
    });

    test("minComplexity: fails when below threshold", () => {
      expect(matchNode(node, { minComplexity: 11 })).toBe(false);
    });

    test("minComplexity: excludes nodes with no complexity data", () => {
      expect(matchNode(noData, { minComplexity: 1 })).toBe(false);
    });

    test("maxComplexity: passes when at or below threshold", () => {
      expect(matchNode(node, { maxComplexity: 10 })).toBe(true);
    });

    test("maxComplexity: fails when above threshold", () => {
      expect(matchNode(node, { maxComplexity: 9 })).toBe(false);
    });

    test("maxComplexity: includes nodes with no complexity data (treated as 0)", () => {
      expect(matchNode(noData, { maxComplexity: 0 })).toBe(true);
    });
  });

  describe("minCognitiveComplexity / maxCognitiveComplexity", () => {
    const node = makeNode({ path: "src/a.ts", cognitiveComplexity: 6 });
    const noData = makeNode({ path: "src/b.ts" });

    test("minCognitiveComplexity: passes when at or above threshold", () => {
      expect(matchNode(node, { minCognitiveComplexity: 6 })).toBe(true);
    });

    test("minCognitiveComplexity: excludes nodes with no data", () => {
      expect(matchNode(noData, { minCognitiveComplexity: 1 })).toBe(false);
    });

    test("maxCognitiveComplexity: fails when above threshold", () => {
      expect(matchNode(node, { maxCognitiveComplexity: 5 })).toBe(false);
    });

    test("maxCognitiveComplexity: includes nodes with no data (treated as 0)", () => {
      expect(matchNode(noData, { maxCognitiveComplexity: 0 })).toBe(true);
    });
  });

  describe("minCommits / maxCommits", () => {
    const node = makeNode({ path: "src/a.ts", commitCount90d: 4 });
    const noData = makeNode({ path: "src/b.ts" });

    test("minCommits: passes when at or above threshold", () => {
      expect(matchNode(node, { minCommits: 4 })).toBe(true);
    });

    test("minCommits: excludes nodes with no git-stats data", () => {
      expect(matchNode(noData, { minCommits: 1 })).toBe(false);
    });

    test("maxCommits: fails when above threshold", () => {
      expect(matchNode(node, { maxCommits: 3 })).toBe(false);
    });

    test("maxCommits: includes nodes with no data (treated as 0)", () => {
      expect(matchNode(noData, { maxCommits: 0 })).toBe(true);
    });
  });

  describe("isDocumented", () => {
    const documented = makeNode({ path: "src/a.ts", documentedBy: ["docs/a.md"] });
    const undocumented = makeNode({ path: "src/b.ts" });

    test("passes when node has documentedBy and query is true", () => {
      expect(matchNode(documented, { isDocumented: true })).toBe(true);
    });

    test("fails when node has no documentedBy and query is true", () => {
      expect(matchNode(undocumented, { isDocumented: true })).toBe(false);
    });

    test("passes when node has no documentedBy and query is false", () => {
      expect(matchNode(undocumented, { isDocumented: false })).toBe(true);
    });
  });

  describe("isStale", () => {
    const stale = makeNode({ path: "src/a.md", staleFor: ["src/a.ts"] });
    const notStale = makeNode({ path: "src/b.md" });

    test("passes when node has staleFor and query is true", () => {
      expect(matchNode(stale, { isStale: true })).toBe(true);
    });

    test("fails when node has no staleFor and query is true", () => {
      expect(matchNode(notStale, { isStale: true })).toBe(false);
    });

    test("passes when node has no staleFor and query is false", () => {
      expect(matchNode(notStale, { isStale: false })).toBe(true);
    });
  });

  describe("lastAuthor", () => {
    const withAuthor = makeNode({ path: "src/a.ts", lastAuthor: "jane" });
    const noAuthor = makeNode({ path: "src/b.ts" });

    test("matches exact value", () => {
      expect(matchNode(withAuthor, { lastAuthor: "jane" })).toBe(true);
    });

    test("rejects different value", () => {
      expect(matchNode(withAuthor, { lastAuthor: "bob" })).toBe(false);
    });

    test("negated: passes when value differs", () => {
      expect(matchNode(withAuthor, { lastAuthor: "!bob" })).toBe(true);
    });

    test("negated: fails when value matches negated term", () => {
      expect(matchNode(withAuthor, { lastAuthor: "!jane" })).toBe(false);
    });

    test("node with no author data fails the positive form", () => {
      expect(matchNode(noAuthor, { lastAuthor: "jane" })).toBe(false);
    });

    test("node with no author data passes the negative form", () => {
      expect(matchNode(noAuthor, { lastAuthor: "!jane" })).toBe(true);
    });
  });

  describe("any — OR groups", () => {
    const node = makeNode({ path: "src/a.ts", category: "logic", tags: [tag("auth")] });

    test("passes when node matches only the first sub-query", () => {
      expect(matchNode(node, { any: [{ category: "logic" }, { category: "ui" }] })).toBe(true);
    });

    test("passes when node matches only the second sub-query", () => {
      expect(matchNode(node, { any: [{ category: "ui" }, { category: "logic" }] })).toBe(true);
    });

    test("fails when node matches neither sub-query", () => {
      expect(matchNode(node, { any: [{ category: "ui" }, { category: "test" }] })).toBe(false);
    });

    test("passes when node matches both sub-queries", () => {
      expect(matchNode(node, { any: [{ category: "logic" }, { tags: ["auth"] }] })).toBe(true);
    });

    test("combined with a top-level AND field that must also pass", () => {
      expect(
        matchNode(node, { path: "src/a.ts", any: [{ category: "logic" }, { category: "ui" }] }),
      ).toBe(true);
      expect(
        matchNode(node, { path: "src/nope.ts", any: [{ category: "logic" }, { category: "ui" }] }),
      ).toBe(false);
    });

    test("empty/absent any is a no-op wildcard", () => {
      expect(matchNode(node, {})).toBe(true);
      expect(matchNode(node, { any: [] })).toBe(true);
    });
  });
});

// ── filterGraph ──────────────────────────────────────────────────────────────

describe("filterGraph", {
  tags: [
    "FileNode",
    "ImportEdge",
    "SerializedGraph",
    "filter",
    "filterGraph",
    "graph",
    "matchNode",
    "node",
  ],
}, () => {
  describe("import edge trimming", () => {
    const graph: SerializedGraph = {
      nodes: [
        makeNode({
          path: "src/a.ts",
          category: "logic",
          imports: [
            makeImport("src/b.ts"),
            makeImport("src/removed.ts"),
            {
              fromPath: "src/a.ts",
              toPath: "",
              isStyle: false,
              rawSpecifier: "external-pkg",
              type: "static",
              isExternal: true,
            },
          ],
        }),
        makeNode({ path: "src/b.ts", category: "logic" }),
        makeNode({ path: "src/removed.ts", category: "other" }),
      ],
    };

    test("removes edges whose target is not in the filtered result", () => {
      const result = filterGraph(graph, { category: "logic" });
      const aNode = result.nodes.find((n) => n.path === "src/a.ts") as FileNode;
      expect(aNode.imports.map((i) => i.toPath)).not.toContain("src/removed.ts");
    });

    test("keeps edges whose target is in the filtered result", () => {
      const result = filterGraph(graph, { category: "logic" });
      const aNode = result.nodes.find((n) => n.path === "src/a.ts") as FileNode;
      expect(aNode.imports.map((i) => i.toPath)).toContain("src/b.ts");
    });

    test("keeps edges with empty toPath (external with no resolved path)", () => {
      const result = filterGraph(graph, { category: "logic" });
      const aNode = result.nodes.find((n) => n.path === "src/a.ts") as FileNode;
      expect(aNode.imports.some((i) => i.toPath === "")).toBe(true);
    });
  });

  describe("sort", () => {
    // Imports point to nodes within the graph, so edge trimming doesn't zero them out.
    // small: 0 imports, commitCount90d=1,  size=100
    // large: 2 imports, commitCount90d=50, size=9000
    // medium: 1 import, commitCount90d=undefined (→0), size=500
    const graph: SerializedGraph = {
      nodes: [
        makeNode({ path: "src/small.ts", size: 100, imports: [], commitCount90d: 1 }),
        makeNode({
          path: "src/large.ts",
          size: 9000,
          imports: [makeImport("src/small.ts"), makeImport("src/medium.ts")],
          commitCount90d: 50,
        }),
        makeNode({ path: "src/medium.ts", size: 500, imports: [makeImport("src/small.ts")] }),
      ],
    };

    test("sort:size orders nodes largest first", () => {
      const result = filterGraph(graph, { sort: "size" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/large.ts",
        "src/medium.ts",
        "src/small.ts",
      ]);
    });

    test("sort:imports orders nodes by most imports first", () => {
      const result = filterGraph(graph, { sort: "imports" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/large.ts",
        "src/medium.ts",
        "src/small.ts",
      ]);
    });

    test("sort:commitCount90d orders nodes by activity descending", () => {
      const result = filterGraph(graph, { sort: "commitCount90d" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/large.ts",
        "src/small.ts",
        "src/medium.ts",
      ]);
    });

    test("sort:commitCount90d treats undefined commitCount90d as 0", () => {
      const result = filterGraph(graph, { sort: "commitCount90d" });
      expect(result.nodes[2]?.path).toBe("src/medium.ts");
    });

    test("sortDir unset preserves descending default (regression)", () => {
      const result = filterGraph(graph, { sort: "size" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/large.ts",
        "src/medium.ts",
        "src/small.ts",
      ]);
    });

    test("sortDir:desc is equivalent to unset", () => {
      const result = filterGraph(graph, { sort: "size", sortDir: "desc" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/large.ts",
        "src/medium.ts",
        "src/small.ts",
      ]);
    });

    test("sortDir:asc reverses order for sort:size", () => {
      const result = filterGraph(graph, { sort: "size", sortDir: "asc" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/small.ts",
        "src/medium.ts",
        "src/large.ts",
      ]);
    });

    test("sortDir:asc reverses order for sort:imports", () => {
      const result = filterGraph(graph, { sort: "imports", sortDir: "asc" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/small.ts",
        "src/medium.ts",
        "src/large.ts",
      ]);
    });

    test("sortDir:asc reverses order for sort:commitCount90d", () => {
      const result = filterGraph(graph, { sort: "commitCount90d", sortDir: "asc" });
      expect(result.nodes.map((n) => n.path)).toEqual([
        "src/medium.ts",
        "src/small.ts",
        "src/large.ts",
      ]);
    });

    test("sort:complexity orders nodes by complexity descending, undefined treated as 0", () => {
      const complexityGraph: SerializedGraph = {
        nodes: [
          makeNode({ path: "src/a.ts", complexity: 5 }),
          makeNode({ path: "src/b.ts", complexity: 20 }),
          makeNode({ path: "src/c.ts" }),
        ],
      };
      const result = filterGraph(complexityGraph, { sort: "complexity" });
      expect(result.nodes.map((n) => n.path)).toEqual(["src/b.ts", "src/a.ts", "src/c.ts"]);
    });

    test("sort:cognitiveComplexity with sortDir:asc orders ascending", () => {
      const complexityGraph: SerializedGraph = {
        nodes: [
          makeNode({ path: "src/a.ts", cognitiveComplexity: 5 }),
          makeNode({ path: "src/b.ts", cognitiveComplexity: 20 }),
          makeNode({ path: "src/c.ts" }),
        ],
      };
      const result = filterGraph(complexityGraph, {
        sort: "cognitiveComplexity",
        sortDir: "asc",
      });
      expect(result.nodes.map((n) => n.path)).toEqual(["src/c.ts", "src/a.ts", "src/b.ts"]);
    });
  });

  describe("limit", () => {
    const graph: SerializedGraph = {
      nodes: [
        makeNode({ path: "src/a.ts", size: 300 }),
        makeNode({ path: "src/b.ts", size: 200 }),
        makeNode({ path: "src/c.ts", size: 100 }),
      ],
    };

    test("truncates result to limit after sort", () => {
      const result = filterGraph(graph, { sort: "size", limit: 2 });
      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map((n) => n.path)).toEqual(["src/a.ts", "src/b.ts"]);
    });

    test("limit larger than result count returns all nodes", () => {
      const result = filterGraph(graph, { limit: 100 });
      expect(result.nodes).toHaveLength(3);
    });
  });

  describe("cycles", () => {
    const graph: SerializedGraph = {
      nodes: [
        makeNode({ path: "src/a.ts", category: "logic" }),
        makeNode({ path: "src/b.ts", category: "logic" }),
        makeNode({ path: "src/c.ts", category: "other" }),
      ],
      cycles: [
        ["src/a.ts", "src/b.ts"],
        ["src/a.ts", "src/c.ts"],
      ],
    };

    test("keeps cycles where all paths are in the filtered result", () => {
      const result = filterGraph(graph, { category: "logic" });
      expect(result.cycles).toEqual([["src/a.ts", "src/b.ts"]]);
    });

    test("removes cycles that include a filtered-out node", () => {
      const result = filterGraph(graph, { category: "logic" });
      expect(result.cycles?.some((c) => c.includes("src/c.ts"))).toBe(false);
    });

    test("returns undefined cycles when graph has no cycles", () => {
      const noCycles: SerializedGraph = { nodes: [makeNode({ path: "src/a.ts" })] };
      const result = filterGraph(noCycles, {});
      expect(result.cycles).toBeUndefined();
    });
  });

  describe("importedBy via filterGraph", () => {
    const graph: SerializedGraph = {
      nodes: [
        makeNode({
          path: "src/service.ts",
          imports: [makeImport("src/db.ts"), makeImport("src/util.ts")],
        }),
        makeNode({ path: "src/db.ts" }),
        makeNode({ path: "src/util.ts" }),
      ],
    };

    test("keeps nodes imported by a file matching the substring", () => {
      const result = filterGraph(graph, { importedBy: "service" });
      expect(result.nodes.map((n) => n.path).sort()).toEqual(["src/db.ts", "src/util.ts"]);
    });

    test("excludes nodes not imported by any file matching the substring", () => {
      const result = filterGraph(graph, { importedBy: "service" });
      expect(result.nodes.map((n) => n.path)).not.toContain("src/service.ts");
    });

    test("empty toPath imports are skipped when building reverse index", () => {
      const graphWithEmpty: SerializedGraph = {
        nodes: [
          makeNode({
            path: "src/service.ts",
            imports: [
              {
                fromPath: "src/service.ts",
                toPath: "",
                isStyle: false,
                rawSpecifier: "pkg",
                type: "static",
                isExternal: true,
              },
              makeImport("src/db.ts"),
            ],
          }),
          makeNode({ path: "src/db.ts" }),
        ],
      };
      const result = filterGraph(graphWithEmpty, { importedBy: "service" });
      expect(result.nodes.map((n) => n.path)).toContain("src/db.ts");
      expect(result.nodes.map((n) => n.path)).not.toContain("src/service.ts");
    });
  });
});
