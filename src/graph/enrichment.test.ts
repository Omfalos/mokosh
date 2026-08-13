import { describe, expect, test } from "vitest";
import type { ExportedSymbol, FileNode, ImportEdge, StructuredTag } from "../types/node";
import {
  enrichCoverage,
  enrichDocDrift,
  enrichExportUsage,
  enrichGraph,
  enrichLibraryTags,
  enrichTestedBy,
  enrichTestNodeTags,
} from "./enrichment";

function makeImport(
  rawSpecifier: string,
  isExternal = false,
  toPath?: string,
  overrides: Partial<ImportEdge> = {},
): ImportEdge {
  return {
    fromPath: "src/a.ts",
    toPath: toPath ?? rawSpecifier,
    rawSpecifier,
    type: "static",
    isStyle: false,
    isExternal,
    ...overrides,
  };
}

function makeNode(
  p: string,
  category: FileNode["category"],
  imports: ImportEdge[] = [],
  tags: StructuredTag[] = [],
  overrides: Partial<FileNode> = {},
): FileNode {
  return {
    path: p,
    type: "typescript",
    category,
    imports,
    exports: [],
    tags,
    mtime: 0,
    size: 0,
    ...overrides,
  };
}

function makeExport(name: string): ExportedSymbol {
  return { name };
}

function tagNames(tags: StructuredTag[]): string[] {
  return tags.map((t) => t.name);
}

describe("enrichLibraryTags", {
  tags: [
    "FileNode",
    "ImportEdge",
    "StructuredTag",
    "enrichLibraryTags",
    "enrichTestNodeTags",
    "enrichment",
    "node",
  ],
}, () => {
  test("adds bare package name as tag", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("lodash", true)], tags);
    expect(tagNames(tags)).toContain("lodash");
  });

  test("adds scoped package name as tag", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("@anthropic-ai/sdk", true)], tags);
    expect(tagNames(tags)).toContain("@anthropic-ai/sdk");
  });

  test("adds only scope+name for deep scoped import", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("@scope/pkg/deep", true)], tags);
    expect(tagNames(tags)).toContain("@scope/pkg");
    expect(tagNames(tags)).not.toContain("@scope/pkg/deep");
  });

  test("strips sub-path from bare package import", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("lodash/merge", true)], tags);
    expect(tagNames(tags)).toContain("lodash");
    expect(tagNames(tags)).not.toContain("lodash/merge");
  });

  test("skips relative imports", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("./utils", false)], tags);
    expect(tags).toHaveLength(0);
  });

  test("skips absolute path imports", () => {
    const tags: StructuredTag[] = [];
    enrichLibraryTags([makeImport("/abs/path", false)], tags);
    expect(tags).toHaveLength(0);
  });

  test("does not add duplicate tags", () => {
    const tags: StructuredTag[] = [{ name: "lodash", kind: "import" }];
    enrichLibraryTags([makeImport("lodash", true)], tags);
    expect(tags.filter((t) => t.name === "lodash")).toHaveLength(1);
  });
});

describe("enrichTestNodeTags", {
  tags: [
    "FileNode",
    "ImportEdge",
    "StructuredTag",
    "enrichLibraryTags",
    "enrichTestNodeTags",
    "enrichment",
    "node",
  ],
}, () => {
  test("adds basename of local import as tag for test node", () => {
    const node = makeNode("src/config.test.ts", "test", [
      makeImport("./config", false, "src/config.ts"),
    ]);
    const nodes = new Map([["src/config.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(tagNames(node.tags)).toContain("config");
  });

  test("strips .test suffix from imported basename", () => {
    const node = makeNode("src/foo.test.ts", "test", [
      makeImport("./foo.test", false, "src/foo.test.ts"),
    ]);
    const nodes = new Map([["src/foo.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(tagNames(node.tags)).toContain("foo");
    expect(tagNames(node.tags)).not.toContain("foo.test");
  });

  test("skips external imports", () => {
    const node = makeNode("src/a.test.ts", "test", [makeImport("vitest", true)]);
    const nodes = new Map([["src/a.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags).toHaveLength(0);
  });

  test("does not touch non-test nodes", () => {
    const node = makeNode("src/a.ts", "logic", [makeImport("./b", false, "src/b.ts")]);
    const nodes = new Map([["src/a.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags).toHaveLength(0);
  });

  test("does not add duplicate tags", () => {
    const node = makeNode(
      "src/config.test.ts",
      "test",
      [makeImport("./config", false, "src/config.ts")],
      [{ name: "config", kind: "import" }],
    );
    const nodes = new Map([["src/config.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags.filter((t) => t.name === "config")).toHaveLength(1);
  });
});

describe("enrichCoverage", () => {
  test("sets coveragePct for a node present in the coverage map", () => {
    const node = makeNode("src/a.ts", "logic");
    const nodes = new Map([["src/a.ts", node]]);
    enrichCoverage(nodes, new Map([["src/a.ts", 87.5]]));
    expect(node.coveragePct).toBe(87.5);
  });

  test("leaves coveragePct undefined for a node absent from the coverage map", () => {
    const node = makeNode("src/a.ts", "logic");
    const nodes = new Map([["src/a.ts", node]]);
    enrichCoverage(nodes, new Map([["src/other.ts", 50]]));
    expect(node.coveragePct).toBeUndefined();
  });
});

describe("enrichTestedBy", () => {
  test("records a test node as tester of a logic node it imports", () => {
    const logicNode = makeNode("src/a.ts", "logic");
    const testNode = makeNode("src/a.test.ts", "test", [makeImport("./a", false, "src/a.ts")]);
    const nodes = new Map([
      ["src/a.ts", logicNode],
      ["src/a.test.ts", testNode],
    ]);
    enrichTestedBy(nodes);
    expect(logicNode.testedBy).toEqual(["src/a.test.ts"]);
  });

  test("records a test node as tester of a barrel node it imports", () => {
    const barrelNode = makeNode("src/index.ts", "barrel");
    const testNode = makeNode("src/index.test.ts", "test", [
      makeImport("./index", false, "src/index.ts"),
    ]);
    const nodes = new Map([
      ["src/index.ts", barrelNode],
      ["src/index.test.ts", testNode],
    ]);
    enrichTestedBy(nodes);
    expect(barrelNode.testedBy).toEqual(["src/index.test.ts"]);
  });

  test("skips external imports and non-logic/barrel targets", () => {
    const configNode = makeNode("src/config.ts", "config");
    const testNode = makeNode("src/config.test.ts", "test", [
      makeImport("./config", false, "src/config.ts"),
      makeImport("vitest", true),
    ]);
    const nodes = new Map([
      ["src/config.ts", configNode],
      ["src/config.test.ts", testNode],
    ]);
    enrichTestedBy(nodes);
    expect(configNode.testedBy).toBeUndefined();
  });

  test("does not add duplicate testedBy entries", () => {
    const logicNode = makeNode("src/a.ts", "logic", [], [], { testedBy: ["src/a.test.ts"] });
    const testNode = makeNode("src/a.test.ts", "test", [makeImport("./a", false, "src/a.ts")]);
    const nodes = new Map([
      ["src/a.ts", logicNode],
      ["src/a.test.ts", testNode],
    ]);
    enrichTestedBy(nodes);
    expect(logicNode.testedBy).toEqual(["src/a.test.ts"]);
  });
});

describe("enrichExportUsage", () => {
  test("computes exportUsageRatio for a partial named import", () => {
    const target = makeNode("src/lib.ts", "logic", [], [], {
      exports: [makeExport("a"), makeExport("b"), makeExport("c"), makeExport("d")],
    });
    const importer = makeNode("src/user.ts", "logic", [
      makeImport("./lib", false, "src/lib.ts", { symbols: ["a", "b"] }),
    ]);
    const nodes = new Map([
      ["src/lib.ts", target],
      ["src/user.ts", importer],
    ]);
    enrichExportUsage(nodes);
    expect(importer.imports[0]?.exportUsageRatio).toBe(0.5);
    expect(importer.avgExportUsage).toBe(0.5);
    expect(importer.maxExportUsage).toBe(0.5);
  });

  test("treats namespace imports as full usage", () => {
    const target = makeNode("src/lib.ts", "logic", [], [], { exports: [makeExport("a")] });
    const importer = makeNode("src/user.ts", "logic", [
      makeImport("./lib", false, "src/lib.ts", { symbols: ["*"] }),
    ]);
    const nodes = new Map([
      ["src/lib.ts", target],
      ["src/user.ts", importer],
    ]);
    enrichExportUsage(nodes);
    expect(importer.imports[0]?.exportUsageRatio).toBe(1);
  });

  test("skips side-effect imports and targets with no exports", () => {
    const target = makeNode("src/style.css", "other", [], [], { exports: [] });
    const importer = makeNode("src/user.ts", "logic", [
      makeImport("./style.css", false, "src/style.css", { type: "side-effect" }),
    ]);
    const nodes = new Map([
      ["src/style.css", target],
      ["src/user.ts", importer],
    ]);
    enrichExportUsage(nodes);
    expect(importer.imports[0]?.exportUsageRatio).toBeUndefined();
    expect(importer.avgExportUsage).toBeUndefined();
  });
});

describe("enrichDocDrift", () => {
  test("links a markdown doc to a referenced file via documentedBy", () => {
    const target = makeNode("src/a.ts", "logic");
    const doc = makeNode("docs/a.md", "other", [makeImport("./a", false, "src/a.ts")], [], {
      type: "markdown",
    });
    const nodes = new Map([
      ["src/a.ts", target],
      ["docs/a.md", doc],
    ]);
    enrichDocDrift(nodes);
    expect(target.documentedBy).toEqual(["docs/a.md"]);
  });

  test("flags staleFor when a logic target committed after the doc", () => {
    const target = makeNode("src/a.ts", "logic", [], [], { lastCommitAt: 200 });
    const doc = makeNode("docs/a.md", "other", [makeImport("./a", false, "src/a.ts")], [], {
      type: "markdown",
      lastCommitAt: 100,
    });
    const nodes = new Map([
      ["src/a.ts", target],
      ["docs/a.md", doc],
    ]);
    enrichDocDrift(nodes);
    expect(doc.staleFor).toEqual(["src/a.ts"]);
  });

  test("does not flag staleFor for non-logic targets even when newer", () => {
    const target = makeNode("src/index.ts", "barrel", [], [], { lastCommitAt: 200 });
    const doc = makeNode("docs/a.md", "other", [makeImport("./index", false, "src/index.ts")], [], {
      type: "markdown",
      lastCommitAt: 100,
    });
    const nodes = new Map([
      ["src/index.ts", target],
      ["docs/a.md", doc],
    ]);
    enrichDocDrift(nodes);
    expect(doc.staleFor).toBeUndefined();
    expect(target.documentedBy).toEqual(["docs/a.md"]);
  });
});

describe("enrichGraph", () => {
  /** Builds one fixture graph exercising every enrichment concern at once. */
  function buildFixture(): Map<string, FileNode> {
    const logicNode = makeNode("src/a.ts", "logic", [], [], {
      exports: [makeExport("foo"), makeExport("bar")],
      lastCommitAt: 200,
    });
    const testNode = makeNode("src/a.test.ts", "test", [
      makeImport("./a", false, "src/a.ts", { symbols: ["foo"] }),
    ]);
    const doc = makeNode("docs/a.md", "other", [makeImport("./a", false, "src/a.ts")], [], {
      type: "markdown",
      lastCommitAt: 100,
    });
    return new Map([
      ["src/a.ts", logicNode],
      ["src/a.test.ts", testNode],
      ["docs/a.md", doc],
    ]);
  }

  test("produces output identical to running the five standalone passes in sequence", () => {
    const fused = buildFixture();
    const sequential = buildFixture();
    const coverageMap = new Map([["src/a.ts", 75]]);

    enrichGraph(fused, coverageMap);

    enrichTestNodeTags(sequential);
    enrichTestedBy(sequential);
    enrichExportUsage(sequential);
    enrichDocDrift(sequential);
    enrichCoverage(sequential, coverageMap);

    expect(fused).toEqual(sequential);
  });

  test("resets testedBy/documentedBy so a stale relationship from a shallow-copied prior node is removed", () => {
    // Simulates GraphBuilder's incremental-reuse path: a node shallow-copied from a previous
    // build carries forward stale-relationship array references.
    const staleLogicNode = makeNode("src/a.ts", "logic", [], [], {
      testedBy: ["src/old.test.ts"],
    });
    const staleDoc = makeNode("docs/a.md", "other", [], [], {
      type: "markdown",
    });
    // The test that previously imported src/a.ts no longer does in the new graph.
    const nodes = new Map([
      ["src/a.ts", staleLogicNode],
      ["docs/a.md", staleDoc],
    ]);

    enrichGraph(nodes, new Map());

    expect(staleLogicNode.testedBy).toBeUndefined();
  });

  test("resets previously-added import-kind test tags but preserves comment-marker tags", () => {
    const testNode = makeNode(
      "src/a.test.ts",
      "test",
      [], // no imports in the new graph — the old "stale-import" tag should disappear
      [
        { name: "stale-import", kind: "import" },
        { name: "auth", kind: "comment-marker" },
      ],
    );
    const nodes = new Map([["src/a.test.ts", testNode]]);

    enrichGraph(nodes, new Map());

    expect(testNode.tags).toEqual([{ name: "auth", kind: "comment-marker" }]);
  });
});
