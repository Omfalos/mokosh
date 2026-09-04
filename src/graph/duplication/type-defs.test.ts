import { describe, expect, test } from "vitest";
import { findTypeDefDuplicates, type TypeScriptSourceFile } from "./type-defs";

function file(name: string, source: string): TypeScriptSourceFile {
  return { file: name, source };
}

describe("findTypeDefDuplicates", () => {
  test("groups two structurally-identical interfaces across files", () => {
    const files = [
      file(
        "a.ts",
        ["export interface UserDto {", "  id: string;", "  name: string;", "}"].join("\n"),
      ),
      file(
        "b.ts",
        ["export interface PersonDto {", "  id: string;", "  name: string;", "}"].join("\n"),
      ),
    ];

    const groups = findTypeDefDuplicates(files);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.defKind).toBe("interface");
    expect(groups[0]?.kind).toBe("definition");
    const names = groups[0]?.occurrences.map((o) => o.name).sort();
    expect(names).toEqual(["PersonDto", "UserDto"]);
  });

  test("groups an interface and a type-literal alias with the same shape", () => {
    const files = [
      file("a.ts", ["export interface Point {", "  x: number;", "  y: number;", "}"].join("\n")),
      file("b.ts", ["export type Coord = {", "  x: number;", "  y: number;", "};"].join("\n")),
    ];

    const groups = findTypeDefDuplicates(files);
    expect(groups).toHaveLength(1);
    const kinds = groups[0]?.occurrences.map((o) => o.name).sort();
    expect(kinds).toEqual(["Coord", "Point"]);
  });

  test("member order does not prevent a match", () => {
    const files = [
      file("a.ts", ["export interface A {", "  id: string;", "  name: string;", "}"].join("\n")),
      file("b.ts", ["export interface B {", "  name: string;", "  id: string;", "}"].join("\n")),
    ];

    expect(findTypeDefDuplicates(files)).toHaveLength(1);
  });

  test("optionality difference prevents a match", () => {
    const files = [
      file("a.ts", ["export interface A {", "  id: string;", "  name: string;", "}"].join("\n")),
      file("b.ts", ["export interface B {", "  id: string;", "  name?: string;", "}"].join("\n")),
    ];

    expect(findTypeDefDuplicates(files)).toHaveLength(0);
  });

  test("never reports a primitive-only type alias", () => {
    const files = [
      file("a.ts", ["export type Id = string;"].join("\n")),
      file("b.ts", ["export type Key = string;"].join("\n")),
    ];

    expect(findTypeDefDuplicates(files)).toHaveLength(0);
  });

  test("never reports a shape below minMembers", () => {
    const files = [
      file("a.ts", ["export interface A {", "  id: string;", "}"].join("\n")),
      file("b.ts", ["export interface B {", "  id: string;", "}"].join("\n")),
    ];

    expect(findTypeDefDuplicates(files)).toHaveLength(0);
  });

  test("returns no groups for a single occurrence", () => {
    const files = [
      file("a.ts", ["export interface A {", "  id: string;", "  name: string;", "}"].join("\n")),
    ];

    expect(findTypeDefDuplicates(files)).toEqual([]);
  });
});
