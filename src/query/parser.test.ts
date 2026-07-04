import { describe, expect, test } from "vitest";
import { parseQuery } from "./parser";

describe("parseQuery", { tags: ["parseQuery", "parser"] }, () => {
  describe("malformed input", () => {
    test("returns empty object for empty string", () => {
      expect(parseQuery("")).toEqual({});
    });

    test("skips parts with no colon", () => {
      expect(parseQuery("categorylogic")).toEqual({});
    });

    test("skips parts with empty key (colon at start)", () => {
      expect(parseQuery(":logic")).toEqual({});
    });

    test("skips parts with empty value (colon at end)", () => {
      expect(parseQuery("category:")).toEqual({});
    });

    test("ignores unknown keys without error", () => {
      expect(parseQuery("unknownkey:somevalue")).toEqual({});
    });

    test("trims whitespace from key and value", () => {
      expect(parseQuery("  category  :  logic  ")).toEqual({ category: "logic" });
    });

    test("value containing a colon uses first colon as delimiter", () => {
      expect(parseQuery("path:src/foo:bar")).toEqual({ path: "src/foo:bar" });
    });
  });

  describe("category", () => {
    test("parses plain value", () => {
      expect(parseQuery("category:logic")).toEqual({ category: "logic" });
    });

    test("parses negated value", () => {
      expect(parseQuery("category:!test")).toEqual({ category: "!test" });
    });
  });

  describe("type", () => {
    test("parses plain value", () => {
      expect(parseQuery("type:typescript")).toEqual({ type: "typescript" });
    });
  });

  describe("tag / tags — OR list", () => {
    test("single tag populates tags array", () => {
      expect(parseQuery("tag:auth")).toEqual({ tags: ["auth"] });
    });

    test("'tags' key is equivalent to 'tag'", () => {
      expect(parseQuery("tags:auth")).toEqual({ tags: ["auth"] });
    });

    test("multiple tag entries accumulate", () => {
      expect(parseQuery("tag:auth,tag:payments")).toEqual({ tags: ["auth", "payments"] });
    });

    test("negated tag is stored as-is in the tags array", () => {
      expect(parseQuery("tag:!internal")).toEqual({ tags: ["!internal"] });
    });

    test("mixed positive and negated tags accumulate", () => {
      expect(parseQuery("tag:auth,tag:!internal")).toEqual({ tags: ["auth", "!internal"] });
    });
  });

  describe("tag — allTags AND list (+ syntax)", () => {
    test("tag with + splits into allTags", () => {
      expect(parseQuery("tag:auth+payments")).toEqual({ allTags: ["auth", "payments"] });
    });

    test("multiple + entries accumulate into allTags", () => {
      expect(parseQuery("tag:auth+payments,tag:core+ui")).toEqual({
        allTags: ["auth", "payments", "core", "ui"],
      });
    });

    test("single-item + still goes into allTags (no actual split)", () => {
      expect(parseQuery("tag:auth+")).toEqual({ allTags: ["auth", ""] });
    });
  });

  describe("path", () => {
    test("parses path value", () => {
      expect(parseQuery("path:src/logic")).toEqual({ path: "src/logic" });
    });
  });

  describe("external", () => {
    test("'true' sets isExternal to true", () => {
      expect(parseQuery("external:true")).toEqual({ isExternal: true });
    });

    test("'True' (mixed case) sets isExternal to true", () => {
      expect(parseQuery("external:True")).toEqual({ isExternal: true });
    });

    test("'false' sets isExternal to false", () => {
      expect(parseQuery("external:false")).toEqual({ isExternal: false });
    });

    test("any non-true value sets isExternal to false", () => {
      expect(parseQuery("external:yes")).toEqual({ isExternal: false });
    });
  });

  describe("importsFile", () => {
    test("parses value", () => {
      expect(parseQuery("importsFile:src/db")).toEqual({ importsFile: "src/db" });
    });
  });

  describe("importedBy", () => {
    test("parses value", () => {
      expect(parseQuery("importedBy:src/index")).toEqual({ importedBy: "src/index" });
    });
  });

  describe("numeric fields", () => {
    test("minImports parses integer", () => {
      expect(parseQuery("minImports:3")).toEqual({ minImports: 3 });
    });

    test("maxImports parses integer", () => {
      expect(parseQuery("maxImports:10")).toEqual({ maxImports: 10 });
    });

    test("minSize parses integer", () => {
      expect(parseQuery("minSize:500")).toEqual({ minSize: 500 });
    });

    test("maxSize parses integer", () => {
      expect(parseQuery("maxSize:2000")).toEqual({ maxSize: 2000 });
    });

    test("limit parses integer", () => {
      expect(parseQuery("limit:5")).toEqual({ limit: 5 });
    });

    test("non-numeric value produces NaN", () => {
      expect(parseQuery("minImports:abc")).toEqual({ minImports: NaN });
    });
  });

  describe("sort", () => {
    test("'size' is accepted", () => {
      expect(parseQuery("sort:size")).toEqual({ sort: "size" });
    });

    test("'imports' is accepted", () => {
      expect(parseQuery("sort:imports")).toEqual({ sort: "imports" });
    });

    test("'commitCount90d' is accepted", () => {
      expect(parseQuery("sort:commitCount90d")).toEqual({ sort: "commitCount90d" });
    });
  });

  describe("hasDocstring", () => {
    test("'true' sets hasDocstring to true", () => {
      expect(parseQuery("hasDocstring:true")).toEqual({ hasDocstring: true });
    });

    test("'false' sets hasDocstring to false", () => {
      expect(parseQuery("hasDocstring:false")).toEqual({ hasDocstring: false });
    });

    test("'False' (mixed case) sets hasDocstring to false", () => {
      expect(parseQuery("hasDocstring:False")).toEqual({ hasDocstring: false });
    });

    test("any non-false value sets hasDocstring to true", () => {
      expect(parseQuery("hasDocstring:yes")).toEqual({ hasDocstring: true });
    });
  });

  describe("combined fields", () => {
    test("all simple string fields together", () => {
      expect(parseQuery("category:logic,type:typescript,path:src,sort:size,limit:10")).toEqual({
        category: "logic",
        type: "typescript",
        path: "src",
        sort: "size",
        limit: 10,
      });
    });

    test("mixed tags and allTags accumulate independently", () => {
      expect(parseQuery("tag:auth,tag:core+ui")).toEqual({
        tags: ["auth"],
        allTags: ["core", "ui"],
      });
    });

    test("malformed parts are skipped without affecting valid ones", () => {
      expect(parseQuery("nocolon,category:logic,:empty,novalue:")).toEqual({
        category: "logic",
      });
    });
  });
});
