import { describe, expect, test } from "vitest";
import { APPLY_TAGS_SAMPLE_LIMIT, type ApplyTagsResult, summarizeApplyTags } from "./applier";

function resultWith(updated: number, unchanged: number, errorText?: string): ApplyTagsResult {
  const files: ApplyTagsResult["files"] = [];
  for (let index = 0; index < updated; index++)
    files.push({ path: `u${index}.test.ts`, status: "updated" });
  for (let index = 0; index < unchanged; index++)
    files.push({ path: `n${index}.test.ts`, status: "unchanged" });
  if (errorText) files.push({ path: "bad.test.ts", status: "error", error: errorText });
  return { updated, unchanged, errors: errorText ? 1 : 0, files };
}

describe("summarizeApplyTags", () => {
  const context = { dryRun: true, root: "/abs/project" };

  test("never lists unchanged files and echoes dryRun", () => {
    const summary = summarizeApplyTags(resultWith(2, 500), context);
    expect(summary.dryRun).toBe(true);
    expect(summary.unchanged).toBe(500);
    expect(summary.files).toHaveLength(2);
    expect(summary.files.every((file) => file.status === "updated")).toBe(true);
    expect(summary.moreUpdated).toBeUndefined();
    expect(summary.hint).toBeUndefined();
  });

  test("caps the updated sample and reports the remainder with a hint", () => {
    const summary = summarizeApplyTags(resultWith(APPLY_TAGS_SAMPLE_LIMIT + 7, 0), context);
    expect(summary.files).toHaveLength(APPLY_TAGS_SAMPLE_LIMIT);
    expect(summary.updated).toBe(APPLY_TAGS_SAMPLE_LIMIT + 7);
    expect(summary.moreUpdated).toBe(7);
    expect(summary.hint).toMatch(/verbose/);
  });

  test("keeps every error, listed first, with the absolute root stripped", () => {
    const summary = summarizeApplyTags(
      resultWith(3, 0, "ENOENT: no such file, open '/abs/project/src/bad.test.ts'"),
      context,
    );
    expect(summary.files[0]).toMatchObject({ path: "bad.test.ts", status: "error" });
    expect(summary.files[0]?.error).toBe("ENOENT: no such file, open './src/bad.test.ts'");
    expect(summary.errors).toBe(1);
  });
});
