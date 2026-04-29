import { describe, expect, it } from "vitest";
import { getTestFiles } from "./utils";

describe("getTestFiles", () => {
  it("keeps .test. files", () => {
    expect(getTestFiles(["src/foo.test.ts"])).toEqual(["src/foo.test.ts"]);
  });

  it("keeps .spec. files", () => {
    expect(getTestFiles(["src/foo.spec.ts"])).toEqual(["src/foo.spec.ts"]);
  });

  it("keeps -test. files", () => {
    expect(getTestFiles(["src/foo-test.ts"])).toEqual(["src/foo-test.ts"]);
  });

  it("keeps -spec. files", () => {
    expect(getTestFiles(["src/foo-spec.ts"])).toEqual(["src/foo-spec.ts"]);
  });

  it("excludes non-test files", () => {
    expect(getTestFiles(["src/foo.ts", "src/bar.ts"])).toEqual([]);
  });

  it("is case-insensitive on the basename", () => {
    expect(getTestFiles(["src/Foo.Test.ts"])).toEqual(["src/Foo.Test.ts"]);
  });

  it("handles mixed arrays", () => {
    const files = ["src/a.ts", "src/a.test.ts", "src/b.spec.js", "src/b.ts"];
    expect(getTestFiles(files)).toEqual(["src/a.test.ts", "src/b.spec.js"]);
  });

  it("returns empty array for empty input", () => {
    expect(getTestFiles([])).toEqual([]);
  });
});
