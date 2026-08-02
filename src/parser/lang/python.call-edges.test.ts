import { describe, expect, test } from "vitest";
import { parsePython } from "./python";

describe("call edges", { tags: ["python", "parsePython", "callEdges"] }, () => {
  test("bare call to a from-imported symbol → raw call edge", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `from mypkg.util import helper\n\ndef foo():\n    helper()\n`,
    );
    expect(rawCallEdges).toEqual([{ from: "foo", to: "helper", toSpecifier: "mypkg.util" }]);
  });

  test("aliased from-import → call edge uses alias to resolve specifier", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `from mypkg.util import helper as h\n\ndef foo():\n    h()\n`,
    );
    expect(rawCallEdges).toEqual([{ from: "foo", to: "h", toSpecifier: "mypkg.util" }]);
  });

  test("relative from-import → call edge uses computed relative specifier", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `from .models import User\n\ndef foo():\n    User()\n`,
    );
    expect(rawCallEdges).toEqual([{ from: "foo", to: "User", toSpecifier: "./models" }]);
  });

  test("call to a locally-defined function (not imported) → not tracked", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `def helper():\n    pass\n\ndef foo():\n    helper()\n`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("bare `import module; module.func()` member access → not tracked", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `import mypkg.util\n\ndef foo():\n    mypkg.util.helper()\n`,
    );
    expect(rawCallEdges).toEqual([]);
  });

  test("call from class method → tracked, qualified as ClassName.methodName", () => {
    const { rawCallEdges } = parsePython(
      "a.py",
      `from mypkg.util import helper\n\nclass Widget:\n    def render(self):\n        helper()\n`,
    );
    expect(rawCallEdges).toEqual([
      { from: "Widget.render", to: "helper", toSpecifier: "mypkg.util" },
    ]);
  });

  test("test file → no call edges collected", () => {
    const { rawCallEdges } = parsePython(
      "test_a.py",
      `from mypkg.util import helper\n\ndef test_foo():\n    helper()\n`,
    );
    expect(rawCallEdges).toEqual([]);
  });
});
