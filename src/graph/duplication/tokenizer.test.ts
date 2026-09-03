import { describe, expect, test } from "vitest";
import { tokenize } from "./tokenizer";

describe("tokenize", () => {
  test("normalizes identifiers to a shared placeholder", () => {
    const tokens = tokenize("const total = a + b;", "typescript").map((t) => t.text);
    expect(tokens).toContain("ID");
    expect(tokens.filter((t) => t === "ID").length).toBe(3); // total, a, b
    expect(tokens).toContain("const"); // keyword, kept verbatim so shape isn't erased
  });

  test("strips // line comments without shifting line numbers", () => {
    const source = "const a = 1; // comment with // inside\nconst b = 2;";
    const tokens = tokenize(source, "typescript");
    expect(tokens.some((t) => t.text === "comment")).toBe(false);
    // second statement's tokens should be on line 2, unaffected by the comment on line 1
    const secondLineTokens = tokens.filter((t) => t.line === 2);
    expect(secondLineTokens.map((t) => t.text)).toEqual(["const", "ID", "=", "NUM", ";"]);
  });

  test("strips /* */ block comments spanning multiple lines, preserving line count", () => {
    const source = "const a = 1;\n/* multi\nline\ncomment */\nconst b = 2;";
    const tokens = tokenize(source, "typescript");
    const lines = tokens.map((t) => t.line);
    expect(Math.max(...lines)).toBe(5);
    expect(lines).not.toContain(2); // nothing tokenized out of the masked comment body
    expect(lines).not.toContain(3);
  });

  test("strips # line comments for python", () => {
    const source = "x = 1  # a comment\ny = 2";
    const tokens = tokenize(source, "python");
    expect(tokens.some((t) => t.text === "comment")).toBe(false);
  });

  test("ignoreLiterals=true normalizes numbers and strings to placeholders", () => {
    const tokens = tokenize('const a = 42; const b = "hello";', "typescript", true).map(
      (t) => t.text,
    );
    expect(tokens).toContain("NUM");
    expect(tokens).toContain("STR");
    expect(tokens).not.toContain("42");
    expect(tokens).not.toContain('"hello"');
  });

  test("ignoreLiterals=false keeps literal text verbatim", () => {
    const tokens = tokenize("const a = 42;", "typescript", false).map((t) => t.text);
    expect(tokens).toContain("42");
  });

  test("unknown file type passes through without stripping comments", () => {
    const tokens = tokenize("foo # not stripped", "unknown").map((t) => t.text);
    expect(tokens).toContain("ID"); // foo
    expect(tokens).toContain("#");
  });

  test("masks single-line and multi-line TS import statements", () => {
    const source = [
      'import { readFile } from "node:fs/promises";',
      'import path from "node:path";',
      "import {",
      "  Foo,",
      "  Bar,",
      '} from "./stuff";',
      "const total = compute(Foo, Bar);",
    ].join("\n");
    const tokens = tokenize(source, "typescript");
    // nothing survives from the import block (lines 1-6)
    expect(tokens.every((t) => t.line >= 7)).toBe(true);
    expect(tokens.map((t) => t.text)).toEqual([
      "const",
      "ID",
      "=",
      "ID",
      "(",
      "ID",
      ",",
      "ID",
      ")",
      ";",
    ]);
  });

  test("masks a Go import ( … ) block", () => {
    const source = [
      "import (",
      '\t"fmt"',
      '\t"os"',
      ")",
      "func main() { fmt.Println(os.Args) }",
    ].join("\n");
    const tokens = tokenize(source, "go");
    expect(tokens.every((t) => t.line === 5)).toBe(true);
  });

  test("masks python import / from-import lines", () => {
    const tokens = tokenize("import os\nfrom a.b import c\nresult = c(os)", "python");
    expect(tokens.every((t) => t.line === 3)).toBe(true);
  });
});
