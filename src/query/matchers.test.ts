import { describe, expect, test } from "vitest";
import type { FileNode, ImportEdge } from "../types/node";
import {
  matchAllTags,
  matchCategory,
  matchHasDocstring,
  matchImportedBy,
  matchImportsFile,
  matchIsExternal,
  matchMaxCoverage,
  matchMaxExportUsage,
  matchMaxImports,
  matchMaxSize,
  matchMinCoverage,
  matchMinExportUsage,
  matchMinImports,
  matchMinSize,
  matchPath,
  matchTags,
  matchType,
} from "./matchers";

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

describe("matchCategory", () => {
  test("passes when query.category is unset", () => {
    expect(matchCategory(makeNode({ path: "a.ts", category: "logic" }), {}, undefined)).toBe(true);
  });

  test("matches exact category", () => {
    const node = makeNode({ path: "a.ts", category: "test" });
    expect(matchCategory(node, { category: "test" }, undefined)).toBe(true);
    expect(matchCategory(node, { category: "logic" }, undefined)).toBe(false);
  });

  test("supports negation", () => {
    const node = makeNode({ path: "a.ts", category: "test" });
    expect(matchCategory(node, { category: "!test" }, undefined)).toBe(false);
    expect(matchCategory(node, { category: "!logic" }, undefined)).toBe(true);
  });
});

describe("matchType", () => {
  test("matches exact type and supports negation", () => {
    const node = makeNode({ path: "a.ts", type: "python" });
    expect(matchType(node, { type: "python" }, undefined)).toBe(true);
    expect(matchType(node, { type: "!python" }, undefined)).toBe(false);
  });
});

describe("matchPath", () => {
  test("matches substring and supports negation", () => {
    const node = makeNode({ path: "src/api/handler.ts" });
    expect(matchPath(node, { path: "src/api" }, undefined)).toBe(true);
    expect(matchPath(node, { path: "!src/api" }, undefined)).toBe(false);
    expect(matchPath(node, { path: "src/ui" }, undefined)).toBe(false);
  });
});

describe("matchIsExternal", () => {
  test("passes when query.isExternal is unset", () => {
    expect(matchIsExternal(makeNode({ path: "a.ts" }), {}, undefined)).toBe(true);
  });

  test("matches nodes with/without an external import", () => {
    const withExternal = makeNode({ path: "a.ts", imports: [makeImport("react", true)] });
    const withoutExternal = makeNode({ path: "b.ts", imports: [makeImport("./local")] });
    expect(matchIsExternal(withExternal, { isExternal: true }, undefined)).toBe(true);
    expect(matchIsExternal(withoutExternal, { isExternal: true }, undefined)).toBe(false);
    expect(matchIsExternal(withoutExternal, { isExternal: false }, undefined)).toBe(true);
  });
});

describe("matchTags", () => {
  test("passes when query.tags is empty", () => {
    expect(matchTags(makeNode({ path: "a.ts" }), { tags: [] }, undefined)).toBe(true);
  });

  test("OR-matches positive tags", () => {
    const node = makeNode({ path: "a.ts", tags: [tag("auth")] });
    expect(matchTags(node, { tags: ["auth", "billing"] }, undefined)).toBe(true);
    expect(matchTags(node, { tags: ["billing"] }, undefined)).toBe(false);
  });

  test("negated tags are mandatory exclusions", () => {
    const node = makeNode({ path: "a.ts", tags: [tag("generated")] });
    expect(matchTags(node, { tags: ["!generated"] }, undefined)).toBe(false);
    expect(matchTags(node, { tags: ["!other"] }, undefined)).toBe(true);
  });
});

describe("matchAllTags", () => {
  test("requires every tag to be present (AND)", () => {
    const node = makeNode({ path: "a.ts", tags: [tag("auth"), tag("core")] });
    expect(matchAllTags(node, { allTags: ["auth", "core"] }, undefined)).toBe(true);
    expect(matchAllTags(node, { allTags: ["auth", "billing"] }, undefined)).toBe(false);
  });
});

describe("matchImportsFile", () => {
  test("matches a substring of any import's toPath", () => {
    const node = makeNode({ path: "a.ts", imports: [makeImport("src/utils/logger.ts")] });
    expect(matchImportsFile(node, { importsFile: "utils/logger" }, undefined)).toBe(true);
    expect(matchImportsFile(node, { importsFile: "utils/other" }, undefined)).toBe(false);
  });
});

describe("matchImportedBy", () => {
  test("matches via the reverse index", () => {
    const node = makeNode({ path: "src/utils/logger.ts" });
    const reverseIndex = new Map([["src/utils/logger.ts", ["src/index.ts"]]]);
    expect(matchImportedBy(node, { importedBy: "src/index" }, reverseIndex)).toBe(true);
    expect(matchImportedBy(node, { importedBy: "src/other" }, reverseIndex)).toBe(false);
  });

  test("treats a missing reverse index as no importers", () => {
    const node = makeNode({ path: "src/utils/logger.ts" });
    expect(matchImportedBy(node, { importedBy: "src/index" }, undefined)).toBe(false);
  });
});

describe("matchMinImports / matchMaxImports", () => {
  test("compare against node.imports.length", () => {
    const node = makeNode({ path: "a.ts", imports: [makeImport("./x"), makeImport("./y")] });
    expect(matchMinImports(node, { minImports: 2 }, undefined)).toBe(true);
    expect(matchMinImports(node, { minImports: 3 }, undefined)).toBe(false);
    expect(matchMaxImports(node, { maxImports: 2 }, undefined)).toBe(true);
    expect(matchMaxImports(node, { maxImports: 1 }, undefined)).toBe(false);
  });
});

describe("matchMinSize / matchMaxSize", () => {
  test("compare against node.size", () => {
    const node = makeNode({ path: "a.ts", size: 1024 });
    expect(matchMinSize(node, { minSize: 1024 }, undefined)).toBe(true);
    expect(matchMinSize(node, { minSize: 2048 }, undefined)).toBe(false);
    expect(matchMaxSize(node, { maxSize: 1024 }, undefined)).toBe(true);
    expect(matchMaxSize(node, { maxSize: 512 }, undefined)).toBe(false);
  });
});

describe("matchHasDocstring", () => {
  test("compares against whether description is set", () => {
    const withDoc = makeNode({ path: "a.ts", description: "does a thing" });
    const withoutDoc = makeNode({ path: "b.ts" });
    expect(matchHasDocstring(withDoc, { hasDocstring: true }, undefined)).toBe(true);
    expect(matchHasDocstring(withoutDoc, { hasDocstring: true }, undefined)).toBe(false);
    expect(matchHasDocstring(withoutDoc, { hasDocstring: false }, undefined)).toBe(true);
  });
});

describe("matchMinCoverage / matchMaxCoverage", () => {
  test("nodes with no coverage data are excluded from minCoverage", () => {
    const node = makeNode({ path: "a.ts" });
    expect(matchMinCoverage(node, { minCoverage: 50 }, undefined)).toBe(true);
  });

  test("nodes with no coverage data are included in maxCoverage", () => {
    const node = makeNode({ path: "a.ts" });
    expect(matchMaxCoverage(node, { maxCoverage: 50 }, undefined)).toBe(true);
  });

  test("compares real coverage values", () => {
    const node = makeNode({ path: "a.ts", coveragePct: 80 });
    expect(matchMinCoverage(node, { minCoverage: 80 }, undefined)).toBe(true);
    expect(matchMinCoverage(node, { minCoverage: 90 }, undefined)).toBe(false);
    expect(matchMaxCoverage(node, { maxCoverage: 80 }, undefined)).toBe(true);
    expect(matchMaxCoverage(node, { maxCoverage: 70 }, undefined)).toBe(false);
  });
});

describe("matchMinExportUsage / matchMaxExportUsage", () => {
  test("nodes with no coupling data are excluded from minExportUsage", () => {
    const node = makeNode({ path: "a.ts" });
    expect(matchMinExportUsage(node, { minExportUsage: 0.5 }, undefined)).toBe(false);
  });

  test("nodes with no coupling data are included in maxExportUsage", () => {
    const node = makeNode({ path: "a.ts" });
    expect(matchMaxExportUsage(node, { maxExportUsage: 0.5 }, undefined)).toBe(true);
  });

  test("compares real export-usage ratios", () => {
    const node = makeNode({ path: "a.ts", avgExportUsage: 0.75 });
    expect(matchMinExportUsage(node, { minExportUsage: 0.75 }, undefined)).toBe(true);
    expect(matchMinExportUsage(node, { minExportUsage: 0.9 }, undefined)).toBe(false);
    expect(matchMaxExportUsage(node, { maxExportUsage: 0.75 }, undefined)).toBe(true);
    expect(matchMaxExportUsage(node, { maxExportUsage: 0.5 }, undefined)).toBe(false);
  });
});
