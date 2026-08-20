import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  applyAtPrefixedTagProp,
  applyReplacements,
  buildRemoveReplacement,
  findTopLevelCalls,
  readArrayProp,
  stripAtPrefix,
  toArrayLiteral,
} from "./ts-ast-utils";

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
}

describe("findTopLevelCalls", () => {
  test("collects describe/test/it calls and ignores unrelated calls", () => {
    const sf = parse(
      'foo();\ndescribe("a", () => {});\ntest("b", () => {});\nit("c", () => {});\n',
    );
    const calls = findTopLevelCalls(sf);
    expect(calls).toHaveLength(3);
  });

  test("collects property-access forms like test.describe", () => {
    const sf = parse('test.describe("suite", () => {});\n');
    expect(findTopLevelCalls(sf)).toHaveLength(1);
  });
});

describe("readArrayProp", () => {
  test("returns null when no options object is present", () => {
    const sf = parse('describe("a", () => {});\n');
    const [call] = findTopLevelCalls(sf);
    expect(call && readArrayProp(call, "tags", sf)).toBeNull();
  });

  test("returns null when the options object lacks the named property", () => {
    const sf = parse('describe("a", { other: 1 }, () => {});\n');
    const [call] = findTopLevelCalls(sf);
    expect(call && readArrayProp(call, "tags", sf)).toBeNull();
  });

  test("returns string array contents when the property is present", () => {
    const sf = parse('describe("a", { tags: ["x", "y"] }, () => {});\n');
    const [call] = findTopLevelCalls(sf);
    expect(call && readArrayProp(call, "tags", sf)).toEqual(["x", "y"]);
  });
});

describe("buildRemoveReplacement", () => {
  test("removes only the target property, keeping siblings, when it is in the middle", () => {
    const sf = parse('describe("a", { x: 1, tags: ["a"], y: 2 }, () => {});\n');
    const [call] = findTopLevelCalls(sf);
    const rep = call && buildRemoveReplacement(call, "tags", sf);
    expect(rep).not.toBeNull();
    expect(applyReplacements(sf.text, rep ? [rep] : [])).toBe(
      'describe("a", { x: 1, y: 2 }, () => {});\n',
    );
  });

  test("returns null when the property is not present", () => {
    const sf = parse('describe("a", { x: 1 }, () => {});\n');
    const [call] = findTopLevelCalls(sf);
    expect(call && buildRemoveReplacement(call, "tags", sf)).toBeNull();
  });
});

describe("toArrayLiteral", () => {
  test("serialises strings as a JSON-quoted array literal", () => {
    expect(toArrayLiteral(["a", "b"])).toBe('["a", "b"]');
    expect(toArrayLiteral([])).toBe("[]");
  });
});

describe("stripAtPrefix", () => {
  test("strips a leading @ from each tag, leaving unprefixed tags untouched", () => {
    expect(stripAtPrefix(["@auth", "smoke"])).toEqual(["auth", "smoke"]);
  });
});

describe("applyAtPrefixedTagProp", () => {
  test("returns source unchanged when no annotatable call is found", () => {
    const source = "const x = 1;\n";
    expect(applyAtPrefixedTagProp("x.ts", source, ["auth"], "tags")).toBe(source);
  });
});
