import { describe, expect, test } from "vitest";
import { parseJava } from "./java";

describe("java complexity", { tags: ["java", "parseJava", "complexity"] }, () => {
  test("straight-line method → complexity 1, cognitive 0", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A { void f() { int x = 1; } }`,
    );
    expect(complexity).toBe(1);
    expect(cognitiveComplexity).toBe(0);
  });

  test("single if → complexity 2, cognitive 1", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A { void f(int x) { if (x > 0) { return; } } }`,
    );
    expect(complexity).toBe(2);
    expect(cognitiveComplexity).toBe(1);
  });

  test("if / else if / else → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A {
  int f(int x) {
    if (x > 0) { return 1; }
    else if (x == 0) { return 0; }
    else { return -1; }
  }
}`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("if with && → complexity 3, cognitive 2", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A { void f(int x) { if (x > 0 && x < 10) { return; } } }`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(2);
  });

  test("for loop with nested if → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A {
  void f(int x) {
    for (int i = 0; i < x; i++) {
      if (i == 5) { break; }
    }
  }
}`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("while + do-while each count once", () => {
    const { complexity } = parseJava(
      "A.java",
      `class A { void f(int x) { while (x > 0) { x--; } do { x++; } while (x < 0); } }`,
    );
    expect(complexity).toBe(3);
  });

  test("switch counts one per non-default case label", () => {
    const { complexity } = parseJava(
      "A.java",
      `class A {
  void f(int i) {
    switch (i) {
      case 1: break;
      case 2: break;
      default: break;
    }
  }
}`,
    );
    expect(complexity).toBe(3);
  });

  test("ternary is a decision point", () => {
    const { complexity, cognitiveComplexity } = parseJava(
      "A.java",
      `class A { int f(int x) { return x > 5 ? 1 : 0; } }`,
    );
    expect(complexity).toBe(2);
    expect(cognitiveComplexity).toBe(1);
  });

  test("each catch clause is a decision point", () => {
    const { complexity } = parseJava(
      "A.java",
      `class A {
  void f() {
    try { g(); }
    catch (RuntimeException e) { h(); }
    catch (Error e2) { }
  }
}`,
    );
    expect(complexity).toBe(3);
  });

  test("per-method breakdown qualifies names as Class.method", () => {
    const { functions } = parseJava(
      "A.java",
      `class Calc {
  int add(int a, int b) { return a + b; }
  int classify(int x) { if (x > 0) return 1; return x < 0 ? -1 : 0; }
}`,
    );
    expect(functions?.map((fn) => fn.name)).toEqual(["Calc.add", "Calc.classify"]);
    const classify = functions?.find((fn) => fn.name === "Calc.classify");
    expect(classify?.complexity).toBe(3);
  });

  test("methods in a nested class are qualified by the inner class name", () => {
    const { functions } = parseJava(
      "A.java",
      `class Outer {
  void a() {}
  static class Inner { void b() {} }
}`,
    );
    expect(functions?.map((fn) => fn.name)).toEqual(["Outer.a", "Inner.b"]);
  });

  test("a constructor keeps its bare type name", () => {
    const { functions } = parseJava("A.java", `class A { A() { if (true) {} } }`);
    expect(functions?.map((fn) => fn.name)).toEqual(["A"]);
  });

  test("a generic method declaration is qualified as Owner.method (regression)", () => {
    const { functions } = parseJava(
      "A.java",
      `class Box {
  <T> T pick(T a, T b) { return a != null ? a : b; }
}`,
    );
    const pick = functions?.find((fn) => fn.name === "Box.pick");
    expect(pick?.name).toBe("Box.pick");
    expect(pick?.complexity).toBe(2);
  });
});
