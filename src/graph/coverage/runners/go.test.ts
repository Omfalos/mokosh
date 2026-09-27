import { describe, expect, it } from "vitest";
import { parseGoCoverProfile } from "./go";

describe("parseGoCoverProfile", () => {
  it("computes per-file statement coverage percentage", () => {
    const profile = [
      "mode: set",
      "example.com/mod/pkg/file.go:10.2,12.16 2 1",
      "example.com/mod/pkg/file.go:14.2,16.16 3 0",
      "example.com/mod/pkg/other.go:5.1,6.10 1 1",
    ].join("\n");

    const result = parseGoCoverProfile(profile, "example.com/mod");

    expect(result.get("pkg/file.go")).toBeCloseTo((2 / 5) * 100);
    expect(result.get("pkg/other.go")).toBe(100);
  });

  it("ignores malformed lines and the mode header", () => {
    const profile = "mode: atomic\nnot a valid line\nexample.com/mod/a.go:1.1,2.2 1 1";
    const result = parseGoCoverProfile(profile, "example.com/mod");
    expect(result.size).toBe(1);
    expect(result.get("a.go")).toBe(100);
  });

  it("returns an empty map for an empty profile", () => {
    expect(parseGoCoverProfile("mode: set\n", "example.com/mod").size).toBe(0);
  });
});
