import { describe, expect, test } from "vitest";
import { tagPackage, withPackageMeta } from "./fanout";

describe("withPackageMeta", () => {
  test("returns items untouched when packageOf is empty (plain root)", () => {
    const items = [{ path: "a.ts" }];
    expect(withPackageMeta(items, new Map())).toBe(items);
  });

  test("adds package where known and leaves unknown paths unchanged", () => {
    const out = withPackageMeta([{ path: "a.ts" }, { path: "z.ts" }], new Map([["a.ts", "pkg"]]));
    expect(out).toEqual([{ path: "a.ts", package: "pkg" }, { path: "z.ts" }]);
  });
});

describe("tagPackage", () => {
  test("tags only when multiple packages were queried and the package name is non-empty", () => {
    const items = [{ n: 1 }];
    expect(tagPackage(items, "p", true)).toEqual([{ n: 1, package: "p" }]);
    expect(tagPackage(items, "p", false)).toBe(items);
    expect(tagPackage(items, "", true)).toBe(items);
  });
});
