import { describe, expect, test } from "vitest";
import { detectMonorepo } from "./index";
import type { MonorepoDetector } from "./registry";
import { getMonorepoDetectors, registerMonorepoDetector } from "./registry";
import type { WorkspacePackage } from "./types";

describe("registry", () => {
  test("getMonorepoDetectors returns built-in detectors registered at module load", () => {
    const types = getMonorepoDetectors().map((d) => d.type);
    expect(types).toContain("pnpm");
    expect(types).toContain("npm");
    expect(types).toContain("yarn");
    expect(types).toContain("nx");
    expect(types).toContain("turborepo");
  });

  test("registerMonorepoDetector appends a custom detector to the global registry", () => {
    const before = getMonorepoDetectors().length;
    const custom: MonorepoDetector = { type: "custom-test-xyz", detect: () => null };
    registerMonorepoDetector(custom);
    const after = getMonorepoDetectors();
    expect(after.length).toBe(before + 1);
    expect(after.some((d) => d.type === "custom-test-xyz")).toBe(true);
  });
});

describe("detectMonorepo with injected detectors (DIP)", () => {
  const pkg: WorkspacePackage = {
    name: "@test/pkg",
    root: "/tmp/pkg",
    relativeRoot: "pkg",
    entryPoints: [],
  };

  test("uses only the supplied detectors, not the global registry", () => {
    const alwaysFires: MonorepoDetector = { type: "always", detect: () => [pkg] };
    const layout = detectMonorepo("/tmp", [alwaysFires]);
    expect(layout.type).toBe("always");
    expect(layout.packages).toHaveLength(1);
  });

  test("returns none when injected detectors list is empty", () => {
    const layout = detectMonorepo("/tmp", []);
    expect(layout.type).toBe("none");
    expect(layout.packages).toHaveLength(0);
  });

  test("returns none when all injected detectors return null", () => {
    const never: MonorepoDetector = { type: "never", detect: () => null };
    const layout = detectMonorepo("/tmp", [never]);
    expect(layout.type).toBe("none");
  });

  test("merges packages from multiple injected detectors, deduplicating by name", () => {
    const pkgA: WorkspacePackage = { name: "@t/a", root: "/a", relativeRoot: "a", entryPoints: [] };
    const pkgB: WorkspacePackage = { name: "@t/b", root: "/b", relativeRoot: "b", entryPoints: [] };
    const d1: MonorepoDetector = { type: "tool1", detect: () => [pkgA, pkgB] };
    const d2: MonorepoDetector = { type: "tool2", detect: () => [pkgB] }; // duplicate @t/b
    const layout = detectMonorepo("/tmp", [d1, d2]);
    expect(layout.types).toEqual(["tool1", "tool2"]);
    expect(layout.packages).toHaveLength(2);
    expect(layout.packageMap.has("@t/a")).toBe(true);
    expect(layout.packageMap.has("@t/b")).toBe(true);
  });
});
