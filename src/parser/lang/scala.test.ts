import { describe, expect, test } from "vitest";
import { parseScala, parseScalaImportClause } from "./scala";

describe("parseScalaImportClause", { tags: ["parseScala", "scala"] }, () => {
  test("plain and Scala 3 aliased", () => {
    expect(parseScalaImportClause("a.b.C")).toEqual(["a.b.C"]);
    expect(parseScalaImportClause("a.b.C as D")).toEqual(["a.b.C"]);
  });

  test("Scala 2 and Scala 3 wildcards and given", () => {
    expect(parseScalaImportClause("a.b._")).toEqual(["a.b.*"]);
    expect(parseScalaImportClause("a.b.*")).toEqual(["a.b.*"]);
    expect(parseScalaImportClause("a.b.given")).toEqual(["a.b.*"]);
  });

  test("brace groups with renames and hiding", () => {
    expect(parseScalaImportClause("a.b.{ C, D => Renamed, E => _ }")).toEqual([
      "a.b.C",
      "a.b.D",
      "a.b.E",
    ]);
  });

  test("Scala 3 multi-import on one line", () => {
    expect(parseScalaImportClause("a.b.C, x.y.Z")).toEqual(["a.b.C", "x.y.Z"]);
  });
});

describe("parseScala", { tags: ["parseScala", "scala"] }, () => {
  test("block-scoped imports inside a body are still captured", () => {
    const { imports } = parseScala(
      "src/main/scala/com/x/A.scala",
      `package com.x
class A {
  import scala.collection.mutable.ListBuffer
  def f = ListBuffer.empty
}
`,
    );
    expect(imports.map((edge) => edge.rawSpecifier)).toContain(
      "scala.collection.mutable.ListBuffer",
    );
  });

  test("top-level class / object / trait names are exports", () => {
    const { exports } = parseScala(
      "A.scala",
      `class A
object B
trait C
case class D(x: Int)
`,
    );
    expect(exports.map((sym) => sym.name)).toEqual(["A", "B", "C", "D"]);
  });

  test("composes consecutive package lines into a synthetic same-package edge", () => {
    const { imports } = parseScala(
      "A.scala",
      `package cats
package data

class NonEmptyList
`,
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "cats.data.*", type: "side-effect" }),
    );
  });

  test("scalatest import marks the file as a test", () => {
    const { category } = parseScala(
      "src/test/scala/com/x/ASpec.scala",
      `import org.scalatest.funsuite.AnyFunSuite\nclass ASpec extends AnyFunSuite`,
    );
    expect(category).toBe("test");
  });

  test("a *ViewModel class name is ui", () => {
    expect(
      parseScala("src/main/scala/com/x/FeedViewModel.scala", `class FeedViewModel`).category,
    ).toBe("ui");
  });

  test("@Service annotation is logic", () => {
    expect(parseScala("src/main/scala/com/x/S.scala", `@Service\nclass S`).category).toBe("logic");
  });
});
