import { describe, expect, it } from "vitest";
import type { MonorepoLayout } from "../workspace/types";
import { resolveCoverageScanRoots } from "./scan-roots";

function layout(packages: MonorepoLayout["packages"]): MonorepoLayout {
  return { root: "/repo", type: "npm", types: ["npm"], packages, packageMap: new Map() };
}

describe("resolveCoverageScanRoots", () => {
  it("returns a single root-prefixed entry when there is no monorepo layout", () => {
    expect(resolveCoverageScanRoots("/repo", undefined)).toEqual([{ dir: "/repo", relPrefix: "" }]);
  });

  it("returns a single root-prefixed entry when layout type is 'none'", () => {
    expect(resolveCoverageScanRoots("/repo", { ...layout([]), type: "none" })).toEqual([
      { dir: "/repo", relPrefix: "" },
    ]);
  });

  it("returns one entry per package, sorted by relativeRoot, prefixed for merging", () => {
    const l = layout([
      { name: "b", root: "/repo/pkgs/b", relativeRoot: "pkgs/b", entryPoints: [] },
      { name: "a", root: "/repo/pkgs/a", relativeRoot: "pkgs/a", entryPoints: [] },
    ]);
    expect(resolveCoverageScanRoots("/repo", l)).toEqual([
      { dir: "/repo/pkgs/a", relPrefix: "pkgs/a/" },
      { dir: "/repo/pkgs/b", relPrefix: "pkgs/b/" },
    ]);
  });

  it("narrows to the given package names when packageFilter is set", () => {
    const l = layout([
      { name: "a", root: "/repo/a", relativeRoot: "a", entryPoints: [] },
      { name: "b", root: "/repo/b", relativeRoot: "b", entryPoints: [] },
    ]);
    expect(resolveCoverageScanRoots("/repo", l, ["b"])).toEqual([
      { dir: "/repo/b", relPrefix: "b/" },
    ]);
  });
});
