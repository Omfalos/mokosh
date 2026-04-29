import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge } from "../types";
import { enrichLibraryTags, enrichTestNodeTags } from "./enrichment";

function makeImport(rawSpecifier: string, isExternal = false, toPath?: string): ImportEdge {
  return {
    fromPath: "src/a.ts",
    toPath: toPath ?? rawSpecifier,
    rawSpecifier,
    type: "static",
    isStyle: false,
    isExternal,
  };
}

function makeNode(
  p: string,
  category: FileNode["category"],
  imports: ImportEdge[] = [],
  tags: string[] = [],
): FileNode {
  return { path: p, type: "typescript", category, imports, exports: [], tags, mtime: 0, size: 0 };
}

describe("enrichLibraryTags", () => {
  test("adds bare package name as tag", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("lodash", true)], tags);
    expect(tags).toContain("lodash");
  });

  test("adds scoped package name as tag", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("@anthropic-ai/sdk", true)], tags);
    expect(tags).toContain("@anthropic-ai/sdk");
  });

  test("adds only scope+name for deep scoped import", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("@scope/pkg/deep", true)], tags);
    expect(tags).toContain("@scope/pkg");
    expect(tags).not.toContain("@scope/pkg/deep");
  });

  test("strips sub-path from bare package import", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("lodash/merge", true)], tags);
    expect(tags).toContain("lodash");
    expect(tags).not.toContain("lodash/merge");
  });

  test("skips relative imports", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("./utils", false)], tags);
    expect(tags).toHaveLength(0);
  });

  test("skips absolute path imports", () => {
    const tags: string[] = [];
    enrichLibraryTags([makeImport("/abs/path", false)], tags);
    expect(tags).toHaveLength(0);
  });

  test("does not add duplicate tags", () => {
    const tags = ["lodash"];
    enrichLibraryTags([makeImport("lodash", true)], tags);
    expect(tags.filter((t) => t === "lodash")).toHaveLength(1);
  });
});

describe("enrichTestNodeTags", () => {
  test("adds basename of local import as tag for test node", () => {
    const node = makeNode("src/config.test.ts", "test", [
      makeImport("./config", false, "src/config.ts"),
    ]);
    const nodes = new Map([["src/config.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags).toContain("config");
  });

  test("strips .test suffix from imported basename", () => {
    const node = makeNode("src/foo.test.ts", "test", [
      makeImport("./foo.test", false, "src/foo.test.ts"),
    ]);
    const nodes = new Map([["src/foo.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags).toContain("foo");
    expect(node.tags).not.toContain("foo.test");
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
      ["config"],
    );
    const nodes = new Map([["src/config.test.ts", node]]);
    enrichTestNodeTags(nodes);
    expect(node.tags.filter((t) => t === "config")).toHaveLength(1);
  });
});
