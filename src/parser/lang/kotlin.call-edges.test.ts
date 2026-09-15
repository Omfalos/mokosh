import { describe, expect, test } from "vitest";
import { parseKotlin } from "./kotlin";

describe("kotlin call edges", { tags: ["kotlin", "parseKotlin", "call-edges"] }, () => {
  test("qualified call on an imported type → one edge", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
class Client {
  fun run() { Foo.stat(1) }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" }]);
  });

  test("qualified call resolves through an `as`-aliased import", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo as Core
class Client {
  fun run() { Core.shout(1) }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.run", to: "shout", toSpecifier: "a.b.Foo" }]);
  });

  test("safe-call navigation (`?.`) still resolves the qualifier", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
class Client {
  fun run() { Foo?.stat(1) }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" }]);
  });

  test('bare constructor call on an imported type → edge to "new"', () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Bar
class Client {
  fun make(): Bar { return Bar() }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.make", to: "new", toSpecifier: "a.b.Bar" }]);
  });

  test("trailing lambda on the same call → single edge, not two", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
class Client {
  fun run() { Foo.shout("x") { it } }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.run", to: "shout", toSpecifier: "a.b.Foo" }]);
  });

  test("superclass constructor delegation → edge from the declaring type", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Base
class Client : Base() {
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client", to: "new", toSpecifier: "a.b.Base" }]);
  });

  test("calls through a wildcard import do not resolve", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.*
class Client {
  fun run() { Foo.stat(1) }
}`,
    );
    expect(rawCallEdges).toBeUndefined();
  });

  test("test files emit no call edges", () => {
    const { rawCallEdges } = parseKotlin(
      "src/test/kotlin/p/ClientTest.kt",
      `package p
import a.b.Foo
class ClientTest {
  fun t() { Foo.stat(1) }
}`,
    );
    expect(rawCallEdges).toBeUndefined();
  });

  test("regression: consecutive bare-call statements with no separator each keep their own edge", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
import a.b.Bar
import a.b.Baz
class Client {
  fun run() {
    Foo.stat(1)
    Bar.other(2)
    Baz.third(3)
  }
}`,
    );
    expect(rawCallEdges).toEqual(
      expect.arrayContaining([
        { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
        { from: "Client.run", to: "other", toSpecifier: "a.b.Bar" },
        { from: "Client.run", to: "third", toSpecifier: "a.b.Baz" },
      ]),
    );
    expect(rawCallEdges).toHaveLength(3);
  });

  test("regression: a bare no-argument constructor call as the second statement keeps its edge", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
import a.b.Bar
class Client {
  fun run() {
    Foo.stat(1)
    Bar()
  }
}`,
    );
    expect(rawCallEdges).toEqual(
      expect.arrayContaining([
        { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
        { from: "Client.run", to: "new", toSpecifier: "a.b.Bar" },
      ]),
    );
    expect(rawCallEdges).toHaveLength(2);
  });

  test("a genuine same-line infix expression is not misread as a qualified call", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
class Client {
  fun run() { val ok = Foo.stat(1) shouldBe Foo.other(2) }
}`,
    );
    expect(rawCallEdges).toEqual(
      expect.arrayContaining([
        { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
        { from: "Client.run", to: "other", toSpecifier: "a.b.Foo" },
      ]),
    );
    expect(rawCallEdges).toHaveLength(2);
  });
});
