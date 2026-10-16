import { describe, expect, it } from "vitest";
import { buildConfigRequired } from "./config-required";

describe("buildConfigRequired", { tags: ["config-required"] }, () => {
  it("names the json config file, the coverage key to add, and the MCP follow-up calls", () => {
    const out = buildConfigRequired({ tool: "find_uncovered", root: "/p", missing: "coverage" });

    expect(out.error).toBe("CONFIG_REQUIRED");
    expect(out.fix.file).toBe("/p/mokosh.config.json");
    expect(out.fix.add).toEqual({ coverage: { mode: "static" } });
    expect(out.fix.alternatives).toHaveLength(2);
    expect(out.nextSteps).toEqual(["clear_cache", "analyze", "find_uncovered"]);
  });

  it("asks for gitStats when git data is missing", () => {
    const out = buildConfigRequired({ tool: "check_doc_drift", root: "/p", missing: "gitStats" });

    expect(out.missingConfig).toBe("gitStats");
    expect(out.fix.add).toEqual({ gitStats: true });
    expect(out.fix.alternatives).toEqual([]);
  });

  it("notes gitStats is optional for find_risk_hotspots", () => {
    const out = buildConfigRequired({
      tool: "find_risk_hotspots",
      root: "/p",
      missing: "gitStats",
    });

    expect(out.fix.notes.some((note) => note.includes("optional"))).toBe(true);
  });

  it("uses CLI wording instead of MCP tool names for the cli surface", () => {
    const out = buildConfigRequired({
      tool: "find_uncovered",
      root: "/p",
      missing: "coverage",
      surface: "cli",
    });

    expect(out.nextSteps).toHaveLength(1);
    expect(out.nextSteps[0]).toContain("--find-uncovered");
  });
});
