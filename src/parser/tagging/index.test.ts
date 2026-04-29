import ts from "typescript";
import { describe, expect, test } from "vitest";
import type { ParseContext } from "../types";
import { handleTagging } from "./index";

function makeCtx(): ParseContext {
  return {
    filePath: "test.ts",
    imports: [],
    exports: new Set(),
    tags: new Set(),
    hasUI: false,
    hasTypesOnly: true,
    totalStatements: 0,
    exportStatements: 0,
  };
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

describe("handleTagging", () => {
  describe("strategy 1 – declaration names", () => {
    test("adds function declaration name as tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function login() {}"), ctx);
      expect(ctx.tags.has("login")).toBe(true);
    });

    test("adds variable declaration name as tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("const logout = () => {};"), ctx);
      expect(ctx.tags.has("logout")).toBe(true);
    });

    test("adds multiple declaration names", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function foo() {} const bar = 1;"), ctx);
      expect(ctx.tags.has("foo")).toBe(true);
      expect(ctx.tags.has("bar")).toBe(true);
    });

    test("ignores anonymous function expressions", () => {
      const ctx = makeCtx();
      visitAll(parseSource("export default function() {}"), ctx);
      expect(ctx.tags.size).toBe(0);
    });

    test("ignores declarations nested inside functions", () => {
      const ctx = makeCtx();
      visitAll(parseSource("function outer() { const inner = 1; }"), ctx);
      expect(ctx.tags.has("inner")).toBe(false);
      expect(ctx.tags.has("outer")).toBe(true);
    });

    test("ignores local variables inside test/describe blocks", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', () => { const tmpDir = '/tmp'; });"), ctx);
      expect(ctx.tags.has("tmpDir")).toBe(false);
    });

    test("ignores variables inside beforeEach", () => {
      const ctx = makeCtx();
      visitAll(parseSource("beforeEach(() => { const unique = 'val'; });"), ctx);
      expect(ctx.tags.has("unique")).toBe(false);
    });
  });

  describe("strategy 2 – @word in string literals", () => {
    test("extracts @tag from test title string", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('login @smoke @regression', () => {});"), ctx);
      expect(ctx.tags.has("smoke")).toBe(true);
      expect(ctx.tags.has("regression")).toBe(true);
    });

    test("extracts @tag with hyphen", () => {
      const ctx = makeCtx();
      visitAll(parseSource("const s = 'do @my-thing';"), ctx);
      expect(ctx.tags.has("my-thing")).toBe(true);
    });

    test("ignores strings without @ markers", () => {
      const ctx = makeCtx();
      const _before = new Set(makeCtx().tags);
      visitAll(parseSource("const s = 'no tags here';"), ctx);
      expect([...ctx.tags].filter((t) => t === "no" || t === "tags" || t === "here").length).toBe(
        0,
      );
    });
  });

  describe("strategy 3 – @tag annotation in comments", () => {
    test("extracts @tag from single-line comment", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag auth\nconst x = 1;"), ctx);
      expect(ctx.tags.has("auth")).toBe(true);
    });

    test("extracts @tag from JSDoc comment", () => {
      const ctx = makeCtx();
      visitAll(parseSource("/** @tag payments */\nfunction pay() {}"), ctx);
      expect(ctx.tags.has("payments")).toBe(true);
    });

    test("extracts multiple @tag annotations", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag smoke\n// @tag critical\nconst x = 1;"), ctx);
      expect(ctx.tags.has("smoke")).toBe(true);
      expect(ctx.tags.has("critical")).toBe(true);
    });

    test("ignores @other-annotations that are not @tag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("/** @param foo bar */\nfunction f(foo: string) {}"), ctx);
      expect(ctx.tags.has("param")).toBe(false);
    });

    test("supports hyphens and underscores in tag names", () => {
      const ctx = makeCtx();
      visitAll(parseSource("// @tag my_tag-1\nconst x = 1;"), ctx);
      expect(ctx.tags.has("my_tag-1")).toBe(true);
    });
  });

  describe("strategy 4 – Vitest option-bag { tags: [...] }", () => {
    test("extracts tags from test() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tags: ['foo', 'bar'] }, () => {});"), ctx);
      expect(ctx.tags.has("foo")).toBe(true);
      expect(ctx.tags.has("bar")).toBe(true);
    });

    test("extracts tags from describe() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', { tags: ['suite-tag'] }, () => {});"), ctx);
      expect(ctx.tags.has("suite-tag")).toBe(true);
    });

    test("extracts tags from it() option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("it('case', { tags: ['it-tag'] }, () => {});"), ctx);
      expect(ctx.tags.has("it-tag")).toBe(true);
    });

    test("recognises chained calls like it.skip()", () => {
      const ctx = makeCtx();
      visitAll(parseSource("it.skip('case', { tags: ['skipped'] }, () => {});"), ctx);
      expect(ctx.tags.has("skipped")).toBe(true);
    });

    test("ignores non-tags properties in option bag", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { timeout: 5000 }, () => {});"), ctx);
      expect(ctx.tags.has("timeout")).toBe(false);
    });

    test("ignores non-array tags value", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tags: 'not-an-array' }, () => {});"), ctx);
      expect(ctx.tags.has("not-an-array")).toBe(false);
    });
  });

  describe("strategy 4 – Playwright option-bag { tag: ... }", () => {
    test("extracts tag from single string with leading @", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tag: '@smoke' }, async () => {});"), ctx);
      expect(ctx.tags.has("smoke")).toBe(true);
    });

    test("extracts tags from array of strings with leading @", () => {
      const ctx = makeCtx();
      visitAll(
        parseSource("test('name', { tag: ['@smoke', '@regression'] }, async () => {});"),
        ctx,
      );
      expect(ctx.tags.has("smoke")).toBe(true);
      expect(ctx.tags.has("regression")).toBe(true);
    });

    test("strips leading @ from tag values", () => {
      const ctx = makeCtx();
      visitAll(parseSource("test('name', { tag: '@critical' }, async () => {});"), ctx);
      expect(ctx.tags.has("critical")).toBe(true);
      expect(ctx.tags.has("@critical")).toBe(false);
    });

    test("works with describe() too", () => {
      const ctx = makeCtx();
      visitAll(parseSource("describe('suite', { tag: '@auth' }, () => {});"), ctx);
      expect(ctx.tags.has("auth")).toBe(true);
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
      expect(ctx.tags.has("auth")).toBe(true);
      expect(ctx.tags.has("login")).toBe(true);
      expect(ctx.tags.has("smoke")).toBe(true);
      expect(ctx.tags.has("critical")).toBe(true);
    });
  });
});
