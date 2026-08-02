import { describe, expect, test } from "vitest";
import { parseGo } from "./go";

describe("complexity", { tags: ["go", "parseGo", "complexity"] }, () => {
  test("straight-line function → complexity 1, cognitive 0", () => {
    const { complexity, cognitiveComplexity } = parseGo("a.go", `func Foo() { x := 1\n_ = x }`);
    expect(complexity).toBe(1);
    expect(cognitiveComplexity).toBe(0);
  });

  test("single if → complexity 2, cognitive 1", () => {
    const { complexity, cognitiveComplexity } = parseGo(
      "a.go",
      `func Foo(x int) { if x > 0 { return } }`,
    );
    expect(complexity).toBe(2);
    expect(cognitiveComplexity).toBe(1);
  });

  test("if / else if / else → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parseGo(
      "a.go",
      `func Foo(x int) int {
	if x > 0 {
		return 1
	} else if x == 0 {
		return 0
	} else {
		return -1
	}
}`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("if with && → complexity 3, cognitive 2", () => {
    const { complexity, cognitiveComplexity } = parseGo(
      "a.go",
      `func Foo(x int) { if x > 0 && x < 10 { return } }`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(2);
  });

  test("for loop with nested if → complexity 3, cognitive 3", () => {
    const { complexity, cognitiveComplexity } = parseGo(
      "a.go",
      `func Foo() {
	for i := 0; i < 10; i++ {
		if i == 5 {
			break
		}
	}
}`,
    );
    expect(complexity).toBe(3);
    expect(cognitiveComplexity).toBe(3);
  });

  test("switch with two cases and a default → complexity 3 (default not counted)", () => {
    const { complexity } = parseGo(
      "a.go",
      `func Foo(i int) {
	switch i {
	case 1:
		return
	case 2:
		return
	default:
		return
	}
}`,
    );
    expect(complexity).toBe(3);
  });

  test("per-function breakdown includes each named function", () => {
    const { functions } = parseGo("a.go", `func Foo() { if true { return } }\nfunc Bar() {}`);
    expect(functions?.map((f) => f.name)).toEqual(["Foo", "Bar"]);
    expect(functions?.[0]).toMatchObject({ complexity: 2, cognitiveComplexity: 1 });
    expect(functions?.[1]).toMatchObject({ complexity: 1, cognitiveComplexity: 0 });
  });

  test("receiver method is qualified as ReceiverType.MethodName", () => {
    const { functions } = parseGo(
      "a.go",
      `type Widget struct{}\nfunc (w *Widget) Render() { if true { return } }`,
    );
    expect(functions?.[0]).toMatchObject({
      name: "Widget.Render",
      complexity: 2,
      cognitiveComplexity: 1,
    });
  });
});
