import { describe, expect, test } from "vitest";
import { parseMarkdown } from "./markdown";

describe("parseMarkdown", { tags: ["parser", "markdown"] }, () => {
  test("tags every emitted edge as a doc reference (ADR-009)", async () => {
    const source = [
      "See [the builder](src/graph/builder.ts) for details.",
      "",
      "The resolver lives in `src/graph/resolver.ts`.",
    ].join("\n");

    const { imports } = await parseMarkdown("docs/architecture.md", source);

    expect(imports.length).toBe(2);
    expect(imports.map((edge) => edge.rawSpecifier).sort()).toEqual([
      "src/graph/builder.ts",
      "src/graph/resolver.ts",
    ]);
    expect(imports.every((edge) => edge.isDocReference === true)).toBe(true);
  });

  test("skips external links and yields no exports/tags", async () => {
    const { imports, exports, tags } = await parseMarkdown(
      "README.md",
      "[home](https://example.com) and [anchor](#usage)",
    );
    expect(imports).toEqual([]);
    expect(exports).toEqual([]);
    expect(tags).toEqual([]);
  });
});
