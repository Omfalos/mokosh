import { describe, expect, test } from "vitest";
import { parseDupQuery } from "./dup-parser";

describe("parseDupQuery", { tags: ["parseDupQuery", "dup-parser"] }, () => {
  describe("basics", () => {
    test("empty string -> empty query", () => {
      expect(parseDupQuery("")).toEqual({});
      expect(parseDupQuery("   ")).toEqual({});
    });

    test("trims whitespace around keys and values", () => {
      expect(parseDupQuery("  path : src/api  ")).toEqual({ path: "src/api" });
    });

    test("ANDs multiple keys", () => {
      expect(parseDupQuery("type:typescript,minLines:20,crossFile:true")).toEqual({
        type: "typescript",
        minLines: 20,
        crossFile: true,
      });
    });

    test("value keeps everything after the first colon", () => {
      expect(parseDupQuery("path:a:b")).toEqual({ path: "a:b" });
    });
  });

  describe("string keys and negation", () => {
    test.each([
      ["path:src/api", { path: "src/api" }],
      ["path:!__tests__", { path: "!__tests__" }],
      ["allPaths:packages/app", { allPaths: "packages/app" }],
      ["family:js", { family: "js" }],
      ["family:!markdown", { family: "!markdown" }],
      ["type:!typescript", { type: "!typescript" }],
      ["kind:definition", { kind: "definition" }],
      ["defKind:cssVar", { defKind: "cssVar" }],
    ])("%s", (input, expected) => {
      expect(parseDupQuery(input)).toEqual(expected);
    });

    test("keys are case-insensitive", () => {
      expect(parseDupQuery("AllPaths:x,MinLines:5")).toEqual({ allPaths: "x", minLines: 5 });
    });
  });

  describe("numeric keys", () => {
    test.each([
      ["minLines:6", { minLines: 6 }],
      ["maxLines:200", { maxLines: 200 }],
      ["minScore:12", { minScore: 12 }],
      ["maxScore:40", { maxScore: 40 }],
      ["minOccurrences:3", { minOccurrences: 3 }],
      ["limit:10", { limit: 10 }],
    ])("%s", (input, expected) => {
      expect(parseDupQuery(input)).toEqual(expected);
    });

    test("throws on a non-numeric numeric value", () => {
      expect(() => parseDupQuery("minLines:lots")).toThrow(/expects a number/);
    });
  });

  describe("bool keys", () => {
    test("crossFile:true / crossFile:false", () => {
      expect(parseDupQuery("crossFile:true")).toEqual({ crossFile: true });
      expect(parseDupQuery("crossFile:false")).toEqual({ crossFile: false });
      expect(parseDupQuery("crossFile:anything")).toEqual({ crossFile: false });
    });
  });

  describe("signal", () => {
    test("accumulates repeated signal clauses, keeping '!' prefixes verbatim", () => {
      expect(parseDupQuery("signal:test,signal:!generated")).toEqual({
        signals: ["test", "!generated"],
      });
    });

    test("signals is an alias for signal", () => {
      expect(parseDupQuery("signals:docs")).toEqual({ signals: ["docs"] });
    });
  });

  describe("sort / sortDir", () => {
    test.each(["lines", "score", "occurrences"])("sort:%s", (field) => {
      expect(parseDupQuery(`sort:${field}`)).toEqual({ sort: field });
    });

    test("throws on an invalid sort field", () => {
      expect(() => parseDupQuery("sort:name")).toThrow(/sort must be one of/);
    });

    test("sortDir normalizes to asc/desc", () => {
      expect(parseDupQuery("sortDir:asc")).toEqual({ sortDir: "asc" });
      expect(parseDupQuery("sortDir:ASC")).toEqual({ sortDir: "asc" });
      expect(parseDupQuery("sortDir:whatever")).toEqual({ sortDir: "desc" });
    });
  });

  describe("errors", () => {
    test("unknown key throws with the known-key list", () => {
      expect(() => parseDupQuery("bogus:1")).toThrow(/unknown key "bogus"/);
    });

    test("clause without a colon throws", () => {
      expect(() => parseDupQuery("pathsrc")).toThrow(/not "key:value"/);
    });

    test("empty key or value is skipped, not an error", () => {
      expect(parseDupQuery(":x")).toEqual({});
      expect(parseDupQuery("path:")).toEqual({});
    });
  });
});
