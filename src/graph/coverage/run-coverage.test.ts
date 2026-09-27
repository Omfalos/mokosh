import { describe, expect, it, vi } from "vitest";
import type { MonorepoLayout } from "../workspace/types";
import { runAutoCoverage } from "./run-coverage";
import type { CoverageRunner } from "./types";

const { jsRunner, pyRunner, failingRunner } = vi.hoisted(() => {
  const jsRunner: CoverageRunner = {
    name: "js",
    detect: (dir: string) => dir.endsWith("frontend"),
    run: async () => new Map([["src/a.ts", 90]]),
  };
  const pyRunner: CoverageRunner = {
    name: "python",
    detect: (dir: string) => dir.endsWith("backend"),
    run: async () => new Map([["app.py", 50]]),
  };
  const failingRunner: CoverageRunner = {
    name: "broken",
    detect: () => true,
    run: async () => {
      throw new Error("boom");
    },
  };
  return { jsRunner, pyRunner, failingRunner };
});

vi.mock("./runners/index", () => ({
  COVERAGE_RUNNERS: [jsRunner, pyRunner, failingRunner],
}));

function layout(packages: MonorepoLayout["packages"]): MonorepoLayout {
  return { root: "/repo", type: "npm", types: ["npm"], packages, packageMap: new Map() };
}

describe("runAutoCoverage", () => {
  it("merges per-package results, prefixing each with its package's relativeRoot", async () => {
    const l = layout([
      { name: "frontend", root: "/repo/frontend", relativeRoot: "frontend", entryPoints: [] },
      { name: "backend", root: "/repo/backend", relativeRoot: "backend", entryPoints: [] },
    ]);
    const result = await runAutoCoverage("/repo", l);
    expect(result.get("frontend/src/a.ts")).toBe(90);
    expect(result.get("backend/app.py")).toBe(50);
  });

  it("swallows a runner that throws and keeps results from the others", async () => {
    const l = layout([
      { name: "frontend", root: "/repo/frontend", relativeRoot: "frontend", entryPoints: [] },
    ]);
    const result = await runAutoCoverage("/repo", l);
    expect(result.get("frontend/src/a.ts")).toBe(90);
    expect(result.size).toBe(1);
  });

  it("returns an empty map when no runner detects anything", async () => {
    const l = layout([{ name: "docs", root: "/repo/docs", relativeRoot: "docs", entryPoints: [] }]);
    const result = await runAutoCoverage("/repo", l);
    expect(result.size).toBe(0);
  });

  it("treats an undefined layout as a single root", async () => {
    const result = await runAutoCoverage("/repo/frontend", undefined);
    expect(result.get("src/a.ts")).toBe(90);
  });
});
