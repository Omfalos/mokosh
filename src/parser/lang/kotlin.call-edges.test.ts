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

  test('bare call to an imported top-level function → edge to its own name, not "new"', () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.parseThing
class Client {
  fun run() { parseThing(1) }
}`,
    );
    expect(rawCallEdges).toEqual([
      { from: "Client.run", to: "parseThing", toSpecifier: "a.b.parseThing" },
    ]);
  });

  test("bare call to an imported top-level function resolves through an `as`-aliased import", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.parseThing as parse
class Client {
  fun run() { parse(1) }
}`,
    );
    expect(rawCallEdges).toEqual([
      { from: "Client.run", to: "parse", toSpecifier: "a.b.parseThing" },
    ]);
  });

  test("bare call to a same-package (unimported) function still does not resolve — issue 12", () => {
    // Documents the known gap (docs/known_issues/12): unlike the imported case above, a bare
    // call to a sibling file's function in the same package (no import needed in Kotlin) has no
    // localNames entry, so it stays unresolved.
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
class Client {
  fun run() { parseThing(1) }
}`,
    );
    expect(rawCallEdges ?? []).toEqual([]);
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

  test("regression: a with-arguments constructor call as the second statement keeps its edge", () => {
    // Previously lost: `(1)` parsed as an error-free ParenthesizedExpression continuing the
    // previous statement. Fixed at the grammar by `Nl` statement separators (tokens.js `nlTokens`).
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
import a.b.Bar
class Client {
  fun run() {
    Foo.stat(1)
    Bar(1)
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

  test("regression: an imported constant used as a `when` condition is not read as a qualifier", () => {
    // Brace-less consecutive branches used to collapse into an InfixExpression, and the (since
    // removed) tree-walking recovery then fabricated `TYPE_PING.readPing` from
    // `TYPE_PING -> readPing(...)`.
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.TYPE_PING
import a.b.TYPE_GOAWAY
class Client {
  fun read(type: Int) {
    when (type) {
      TYPE_PING -> readPing(1)
      TYPE_GOAWAY -> readGoAway(2)
      else -> other()
    }
  }
}`,
    );
    expect(rawCallEdges ?? []).toEqual([]);
  });
  test("calls inside an extension function are attributed to it by its own name", () => {
    const { rawCallEdges } = parseKotlin(
      "src/main/kotlin/p/Ext.kt",
      `package p
import a.b.Foo
fun String.shout() {
  Foo.stat(1)
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "shout", to: "stat", toSpecifier: "a.b.Foo" }]);
  });

  const edgesOf = (body: string) =>
    parseKotlin(
      "src/main/kotlin/p/Client.kt",
      `package p
import a.b.Foo
import a.b.Bar
class Client {
  fun run() { ${body} }
}`,
    ).rawCallEdges;

  test("explicit type arguments on a qualified call keep the edge", () => {
    expect(edgesOf("Foo.stat<String>(1)")).toEqual([
      { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
    ]);
    expect(edgesOf("val x = Foo.make<Int, String>(1)")).toEqual([
      { from: "Client.run", to: "make", toSpecifier: "a.b.Foo" },
    ]);
  });

  test("a generic constructor call is a constructor edge", () => {
    expect(edgesOf("Bar<Int>()")).toEqual([
      { from: "Client.run", to: "new", toSpecifier: "a.b.Bar" },
    ]);
  });

  test("calls inside a labeled lambda are still attributed to the enclosing function", () => {
    expect(edgesOf("list.forEach loop@{ Foo.stat(it) }")).toEqual([
      { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
    ]);
    expect(edgesOf("run { Foo.stat(1); return@run }")).toEqual([
      { from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" },
    ]);
  });

  test("a destructuring declaration's initializer keeps its edge", () => {
    expect(edgesOf("val (a, b) = Foo.pair()")).toEqual([
      { from: "Client.run", to: "pair", toSpecifier: "a.b.Foo" },
    ]);
  });
});
