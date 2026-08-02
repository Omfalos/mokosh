import { describe, expect, test } from "vitest";
import { parseGo } from "./go";

describe("call edges", { tags: ["go", "parseGo", "callEdges"] }, () => {
  test("package-qualified call from exported function → raw call edge", () => {
    const { rawCallEdges } = parseGo(
      "main.go",
      `package main\n\nimport "myapp/util"\n\nfunc Foo() {\n\tutil.Helper()\n}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Foo", to: "Helper", toSpecifier: "myapp/util" }]);
  });

  test("aliased import → call edge uses alias to resolve specifier", () => {
    const { rawCallEdges } = parseGo(
      "main.go",
      `package main\n\nimport u "myapp/util"\n\nfunc Foo() {\n\tu.Helper()\n}`,
    );
    expect(rawCallEdges).toEqual([{ from: "Foo", to: "Helper", toSpecifier: "myapp/util" }]);
  });

  test("unqualified same-file call → not tracked", () => {
    const { rawCallEdges } = parseGo(
      "main.go",
      `package main\n\nfunc helper() {}\n\nfunc Foo() {\n\thelper()\n}`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("call from unexported top-level function → not tracked", () => {
    const { rawCallEdges } = parseGo(
      "main.go",
      `package main\n\nimport "myapp/util"\n\nfunc foo() {\n\tutil.Helper()\n}`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("call from receiver method (any visibility) → tracked, qualified as Type.Method", () => {
    const { rawCallEdges } = parseGo(
      "main.go",
      `package main\n\nimport "myapp/util"\n\ntype Widget struct{}\n\nfunc (w *Widget) render() {\n\tutil.Helper()\n}`,
    );
    expect(rawCallEdges).toEqual([
      { from: "Widget.render", to: "Helper", toSpecifier: "myapp/util" },
    ]);
  });

  test("test file → no call edges collected", () => {
    const { rawCallEdges } = parseGo(
      "main_test.go",
      `package main\n\nimport "myapp/util"\n\nfunc Foo() {\n\tutil.Helper()\n}`,
    );
    expect(rawCallEdges).toEqual([]);
  });
});
