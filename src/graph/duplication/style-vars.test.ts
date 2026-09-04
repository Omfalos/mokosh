import { describe, expect, test } from "vitest";
import type { StyleSourceFile } from "./style-blocks";
import { findStyleVarDuplicates } from "./style-vars";

function file(name: string, source: string): StyleSourceFile {
  const fileType = name.endsWith(".scss") ? "scss" : name.endsWith(".less") ? "less" : "css";
  return { file: name, source, fileType };
}

describe("findStyleVarDuplicates", () => {
  test("reports a consolidation candidate for the same value under different CSS custom-property names", () => {
    const files = [
      file("a.css", [":root {", "  --brand: #3b82f6;", "}"].join("\n")),
      file("b.css", [":root {", "  --primary: #3b82f6;", "}"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    const consolidation = groups.filter((g) => g.signals === undefined);
    expect(consolidation).toHaveLength(1);
    expect(consolidation[0]?.defKind).toBe("cssVar");
    expect(consolidation[0]?.kind).toBe("definition");
    const names = consolidation[0]?.occurrences.map((o) => o.name).sort();
    expect(names).toEqual(["--brand", "--primary"]);
  });

  test("matches an SCSS variable and a CSS custom property holding the same value", () => {
    const files = [
      file("a.scss", ["$brand: #3b82f6;"].join("\n")),
      file("b.css", [":root {", "  --brand: #3b82f6;", "}"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    expect(groups.some((g) => g.occurrences.some((o) => o.name === "$brand"))).toBe(true);
  });

  test("reports a consolidation candidate for a duplicated Less variable", () => {
    const files = [
      file("a.less", ["@brand: #3b82f6;"].join("\n")),
      file("b.less", ["@primary: #3b82f6;"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    const consolidation = groups.filter((g) => g.signals === undefined);
    expect(consolidation).toHaveLength(1);
    const names = consolidation[0]?.occurrences.map((o) => o.name).sort();
    expect(names).toEqual(["@brand", "@primary"]);
  });

  test("flags value drift when the same variable name holds different values across files", () => {
    const files = [
      file("a.css", [":root {", "  --spacing-md: 8px;", "}"].join("\n")),
      file("b.css", [":root {", "  --spacing-md: 6px;", "}"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.signals).toEqual(["value-drift"]);
    const values = groups[0]?.occurrences.map((o) => o.value).sort();
    expect(values).toEqual(["6px", "8px"]);
  });

  test("does not flag drift for a same-name, same-value declaration repeated across files", () => {
    const files = [
      file("a.css", [":root {", "  --spacing-md: 8px;", "}"].join("\n")),
      file("b.css", [":root {", "  --spacing-md: 8px;", "}"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    expect(groups.every((g) => g.signals === undefined)).toBe(true);
  });

  test("finds variables nested inside a rule or @media block, not just root-level", () => {
    const files = [
      file(
        "a.css",
        ["@media (min-width: 600px) {", "  .card {", "    --card-gap: 12px;", "  }", "}"].join(
          "\n",
        ),
      ),
      file("b.css", [".panel {", "  --card-gap: 12px;", "}"].join("\n")),
    ];

    const groups = findStyleVarDuplicates(files);
    expect(groups.some((g) => g.signals === undefined)).toBe(true);
  });

  test("returns no groups when nothing is shared", () => {
    const files = [
      file("a.css", [":root {", "  --brand: #3b82f6;", "}"].join("\n")),
      file("b.css", [":root {", "  --accent: #f43f5e;", "}"].join("\n")),
    ];

    expect(findStyleVarDuplicates(files)).toEqual([]);
  });
});
