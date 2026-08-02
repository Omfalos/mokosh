import { describe, expect, test } from "vitest";
import { parsePython } from "./python";

describe("complexity", { tags: ["python", "parsePython", "complexity"] }, () => {
  test("straight-line function → complexity 1, cognitive 0", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo():\n    x = 1\n    return x`,
    );
    expect(complexity).toBe(1);
    expect(cognitiveComplexity).toBe(0);
  });

  test("single if → complexity 2, cognitive 1", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo(x):\n    if x > 0:\n        return x`,
    );
    expect(complexity).toBe(2);
    expect(cognitiveComplexity).toBe(1);
  });

  test("if / elif / else → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo(x):
    if x > 0:
        return 1
    elif x == 0:
        return 0
    else:
        return -1`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("if with and → complexity 3, cognitive 2", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo(x):\n    if x > 0 and x < 10:\n        return x`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(2);
  });

  test("for loop with nested if → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo():
    for i in range(10):
        if i == 5:
            break`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("try / except / except → complexity 3", () => {
    const { complexity } = parsePython(
      "a.py",
      `def foo():
    try:
        pass
    except ValueError:
        pass
    except Exception:
        pass`,
    );
    expect(complexity).toBe(3);
  });

  test("ternary → complexity 2, cognitive 1", () => {
    const { complexity, cognitiveComplexity } = parsePython(
      "a.py",
      `def foo(x):\n    return 1 if x else 2`,
    );
    expect(complexity).toBe(2);
    expect(cognitiveComplexity).toBe(1);
  });

  test("per-function breakdown includes each named function", () => {
    const { functions } = parsePython(
      "a.py",
      `def foo():\n    if True:\n        return 1\n\ndef bar():\n    return 2`,
    );
    expect(functions?.map((f) => f.name)).toEqual(["foo", "bar"]);
    expect(functions?.[0]).toMatchObject({ complexity: 2, cognitiveComplexity: 1 });
    expect(functions?.[1]).toMatchObject({ complexity: 1, cognitiveComplexity: 0 });
  });

  test("class method is qualified as ClassName.methodName", () => {
    const { functions } = parsePython(
      "a.py",
      `class Widget:\n    def render(self):\n        if True:\n            return 1`,
    );
    expect(functions?.[0]).toMatchObject({
      name: "Widget.render",
      complexity: 2,
      cognitiveComplexity: 1,
    });
  });
});
