import ts from "typescript";
import { describe, expect, test } from "vitest";
import type { StructuredTag } from "../../types/node";
import type { ParseContext } from "../types";
import { handleTagging } from "./index";

function makeCtx(): ParseContext {
  return {
    filePath: "test.ts",
    imports: [],
    exports: new Map(),
    tags: new Set<StructuredTag>(),
    sourceFile: ts.createSourceFile("test.ts", "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    hasUI: false,
    hasTypesOnly: true,
    totalStatements: 0,
    exportStatements: 0,
  };
}

function hasTag(tags: Set<StructuredTag>, name: string): boolean {
  return [...tags].some((t) => t.name === name);
}

function parseSource(code: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function visitAll(sourceFile: ts.SourceFile, ctx: ParseContext): void {
  const visit = (node: ts.Node) => {
    handleTagging(node, ctx);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

describe("handleTagging", {
  tags: ["ParseContext", "StructuredTag", "handleTagging", "node"],
}, () => {
  describe("strategy 1 – declaration names", () => {
    test("adds function declaration name as tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function login() {}"), ctx);
      expect(hasTag(ctx.tags, "login")).toBe(true);
    });

    test("adds variable declaration name as tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("const logout = () => {};"), ctx);
      expect(hasTag(ctx.tags, "logout")).toBe(true);
    });

    test("adds multiple declaration names", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function foo() {} const bar = 1;"), ctx);
      expect(hasTag(ctx.tags, "foo")).toBe(true);
      expect(hasTag(ctx.tags, "bar")).toBe(true);
    });

    test("ignores anonymous function expressions", () => {
      const ctx = makeCtx();
      visitAll(parseSource("export default function() {}"), ctx);
      expect(ctx.tags.size).toBe(0);
    });

    test("ignores declarations nested inside functions", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function outer() { const inner = 1; }"), ctx);
      expect(hasTag(ctx.tags, "inner")).toBe(false);
      expect(hasTag(ctx.tags, "outer")).toBe(true);
    });

    test("ignores local variables inside test/describe blocks", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', () => { const tmpDir = '/tmp'; });"), ctx);
      expect(hasTag(ctx.tags, "tmpDir")).toBe(false);
    });

    test("ignores variables inside beforeEach", () => {
      const ctx = makeCtx();
      visitAll(parseSource("beforeEach(() => { const unique = 'val'; });"), ctx);
      expect(hasTag(ctx.tags, "unique")).toBe(false);
    });
  });

  describe("strategy 2 – @word in string literals", () => {
    test("extracts @tag from test title string", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('login @smoke @regression', () => {});"), ctx);
      expect(hasTag(ctx.tags, "smoke")).toBe(true);
      expect(hasTag(ctx.tags, "regression")).toBe(true);
    });

    test("extracts @tag with hyphen", () => {
      const ctx = makeCtx();
      visitAll(parseSource("const s = 'do @my-thing';"), ctx);
      expect(hasTag(ctx.tags, "my-thing")).toBe(true);
    });

    test("ignores strings without @ markers", () => {
      const ctx = makeCtx();
      const _before = new Set(makeCtx().tags);
      visitAll(parseSource("const s = 'no tags here';"), ctx);
      expect(
        [...ctx.tags].filter((t) => t.name === "no" || t.name === "tags" || t.name === "here")
          .length,
      ).toBe(0);
    });
  });

  describe("strategy 3 – @tag annotation in comments", () => {
    test("extracts @tag from single-line comment", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag auth\nconst x = 1;"), ctx);
      expect(hasTag(ctx.tags, "auth")).toBe(true);
    });

    test("extracts @tag from JSDoc comment", () => {
      const ctx = makeCtx();
      visitAll(parseSource("/** @tag payments */\nfunction pay() {}"), ctx);
      expect(hasTag(ctx.tags, "payments")).toBe(true);
    });

    test("extracts multiple @tag annotations", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag smoke\n// @tag critical\nconst x = 1;"), ctx);
      expect(hasTag(ctx.tags, "smoke")).toBe(true);
      expect(hasTag(ctx.tags, "critical")).toBe(true);
    });

    test("ignores @other-annotations that are not @tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("/** @param foo bar */\nfunction f(foo: string) {}"), ctx);
      expect(hasTag(ctx.tags, "param")).toBe(false);
    });

    test("supports hyphens and underscores in tag names", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag my_tag-1\nconst x = 1;"), ctx);
      expect(hasTag(ctx.tags, "my_tag-1")).toBe(true);
    });
  });

  describe("strategy 4 – Vitest option-bag { tags: [...] }", () => {
    test("extracts tags from test() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tags: ['foo', 'bar'] }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "foo")).toBe(true);
      expect(hasTag(ctx.tags, "bar")).toBe(true);
    });

    test("extracts tags from describe() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', { tags: ['suite-tag'] }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "suite-tag")).toBe(true);
    });

    test("extracts tags from it() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("it('case', { tags: ['it-tag'] }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "it-tag")).toBe(true);
    });

    test("recognises chained calls like it.skip()", () => {
      const ctx = makeCtx();
      visitAll(parseSource("it.skip('case', { tags: ['skipped'] }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "skipped")).toBe(true);
    });

    test("ignores non-tags properties in option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { timeout: 5000 }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "timeout")).toBe(false);
    });

    test("ignores non-array tags value", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tags: 'not-an-array' }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "not-an-array")).toBe(false);
    });
  });

  describe("strategy 4 – Playwright option-bag { tag: ... }", () => {
    test("extracts tag from single string with leading @", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tag: '@smoke' }, async () => {});"), ctx);
      expect(hasTag(ctx.tags, "smoke")).toBe(true);
    });

    test("extracts tags from array of strings with leading @", () => {
      const ctx = makeCtx();
      visitAll(
        parseSource("test('name', { tag: ['@smoke', '@regression'] }, async () => {});"),
        ctx,
      );
      expect(hasTag(ctx.tags, "smoke")).toBe(true);
      expect(hasTag(ctx.tags, "regression")).toBe(true);
    });

    test("strips leading @ from tag values", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tag: '@critical' }, async () => {});"), ctx);
      expect(hasTag(ctx.tags, "critical")).toBe(true);
      expect(hasTag(ctx.tags, "@critical")).toBe(false);
    });

    test("works with describe() too", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', { tag: '@auth' }, () => {});"), ctx);
      expect(hasTag(ctx.tags, "auth")).toBe(true);
    });
  });

  describe("combined strategies", () => {
    test("collects tags from all strategies in one file", () => {
      const ctx = makeCtx();
      visitAll(
        parseSource(`
          // @tag auth
          function login() {}
          test('smoke @smoke', { tags: ['critical'] }, () => {});
        `),
        ctx,
      );
      expect(hasTag(ctx.tags, "auth")).toBe(true);
      expect(hasTag(ctx.tags, "login")).toBe(true);
      expect(hasTag(ctx.tags, "smoke")).toBe(true);
      expect(hasTag(ctx.tags, "critical")).toBe(true);
    });
  });
});
