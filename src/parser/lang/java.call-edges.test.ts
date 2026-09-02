import { describe, expect, test } from "vitest";
import { parseJava } from "./java";

describe("java call edges", { tags: ["java", "parseJava", "call-edges"] }, () => {
  test("static call on an imported type → one edge", () => {
    const { rawCallEdges } = parseJava(
      "src/main/java/p/Client.java",
      `package p;
import a.b.Foo;
class Client {
  void run() { Foo.stat(1); }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.run", to: "stat", toSpecifier: "a.b.Foo" }]);
  });

  test('constructor call on an imported type → edge to "new"', () => {
    const { rawCallEdges } = parseJava(
      "src/main/java/p/Client.java",
      `package p;
import a.b.Bar;
class Client {
  Bar make() { return new Bar(); }
}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Client.make", to: "new", toSpecifier: "a.b.Bar" }]);
  });

  test("calls on non-imported / fully-qualified types are ignored", () => {
    const { rawCallEdges } = parseJava(
      "src/main/java/p/Client.java",
      `package p;
class Client {
  void run() {
    java.util.List<String> x = new java.util.ArrayList<>();
    helper.doThing();
  }
}`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("wildcard imports do not seed the type map", () => {
    const { rawCallEdges } = parseJava(
      "src/main/java/p/Client.java",
      `package p;
import a.b.*;
class Client {
  void run() { Foo.stat(); }
}`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("test files emit no call edges", () => {
    const { rawCallEdges } = parseJava(
      "app/src/test/java/p/ClientTest.java",
      `package p;
import a.b.Foo;
class ClientTest {
  void t() { Foo.stat(1); }
}`,
    );
    expect(rawCallEdges).toEqual([]);
  });
});
