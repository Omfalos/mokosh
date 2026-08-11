import { describe, expect, test } from "vitest";
import { findStyleBlockDuplicates, type StyleSourceFile } from "./style-blocks";

function file(name: string, source: string): StyleSourceFile {
  const fileType = name.endsWith(".scss") ? "scss" : name.endsWith(".less") ? "less" : "css";
  return { file: name, source, fileType };
}

describe("findStyleBlockDuplicates", () => {
  test("reports two different selectors sharing an identical declaration body", () => {
    const files = [
      file(
        "a.css",
        [".header {", "  display: flex;", "  align-items: center;", "  color: red;", "}"].join(
          "\n",
        ),
      ),
      file(
        "b.css",
        [".footer {", "  display: flex;", "  align-items: center;", "  color: red;", "}"].join(
          "\n",
        ),
      ),
    ];

    const groups = findStyleBlockDuplicates(files, 3);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.family).toBe("style");
    const found = groups[0]?.occurrences.map((o) => o.file).sort();
    expect(found).toEqual(["a.css", "b.css"]);
  });

  test("does not match rules with the same declaration shape but different values — the ADR-013 false positive", () => {
    const files = [
      file("a.css", [".header {", "  display: flex;", "  color: red;", "}"].join("\n")),
      file("b.css", [".footer {", "  display: block;", "  color: blue;", "}"].join("\n")),
    ];

    const groups = findStyleBlockDuplicates(files, 2);
    expect(groups).toHaveLength(0);
  });

  test("ignores incidental whitespace differences in values", () => {
    const files = [
      file("a.css", [".a {", "  margin: 0   10px   0   10px;", "  color: red;", "}"].join("\n")),
      file("b.css", [".b {", "  margin: 0 10px 0 10px;", "  color: red;", "}"].join("\n")),
    ];

    const groups = findStyleBlockDuplicates(files, 2);
    expect(groups).toHaveLength(1);
  });

  test("skips blocks below minDeclarations even if minLines is met", () => {
    const files = [
      file("a.css", [".a {", "  display: none;", "}"].join("\n")),
      file("b.css", [".b {", "  display: none;", "}"].join("\n")),
    ];

    const groups = findStyleBlockDuplicates(files, 1, 2);
    expect(groups).toHaveLength(0);
  });

  test("matches nested SCSS rules (e.g. inside @media) the same as top-level ones", () => {
    const files = [
      file(
        "a.scss",
        [
          "@media (min-width: 600px) {",
          "  .card {",
          "    padding: 1rem;",
          "    border-radius: 4px;",
          "  }",
          "}",
        ].join("\n"),
      ),
      file("b.scss", [".panel {", "  padding: 1rem;", "  border-radius: 4px;", "}"].join("\n")),
    ];

    const groups = findStyleBlockDuplicates(files, 2);
    expect(groups).toHaveLength(1);
  });

  test("returns no groups for a single occurrence", () => {
    const files = [file("a.css", [".a {", "  color: red;", "  margin: 0;", "}"].join("\n"))];
    expect(findStyleBlockDuplicates(files, 1)).toEqual([]);
  });
});
