import { describe, expect, it } from "vitest";
import { DefaultTestNodeIdentifier } from "./identifier";

describe("DefaultTestNodeIdentifier", () => {
  const identifier = new DefaultTestNodeIdentifier();

  it("treats category test as a test node", () => {
    expect(identifier.isTestNode({ category: "test", tags: [] })).toBe(true);
  });

  it("treats a non-library tag named test as a test node", () => {
    expect(
      identifier.isTestNode({
        category: "other",
        tags: [{ name: "test", kind: "comment-marker" }],
      }),
    ).toBe(true);
  });

  it("ignores a library tag named test (e.g. a markdown doc mentioning it)", () => {
    expect(
      identifier.isTestNode({ category: "other", tags: [{ name: "test", kind: "library" }] }),
    ).toBe(false);
  });
});
