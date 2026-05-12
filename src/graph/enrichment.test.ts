import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge, StructuredTag } from "../types";
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
  tags: StructuredTag[] = [],
): FileNode {
  return { path: p, type: "typescript", category, imports, exports: [], tags, mtime: 0, size: 0 };
}

function tagNames(tags: StructuredTag[]): string[] {
  return tags.map((t) => t.name);
}

describe("enrichLibraryTags", () => {
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

describe("enrichTestNodeTags", () => {
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
