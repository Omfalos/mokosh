import { afterEach, describe, expect, it } from "vitest";
import {
  configureTagQuality,
  DEFAULT_TAG_BLOCKLIST,
  isSelectionTag,
  isSelectionTagName,
  resetTagQuality,
  selectionTagNames,
} from "./tag-quality";
import type { StructuredTag } from "./types/node";

const tag = (name: string, kind: StructuredTag["kind"] = "comment-marker"): StructuredTag => ({
  name,
  kind,
});

afterEach(() => resetTagQuality());

describe("isSelectionTag", () => {
  it("keeps comment-marker and import kinds", () => {
    expect(isSelectionTag(tag("auth", "comment-marker"))).toBe(true);
    expect(isSelectionTag(tag("builder", "import"))).toBe(true);
  });

  it("rejects declaration and library kinds", () => {
    expect(isSelectionTag(tag("makeContext", "function"))).toBe(false);
    expect(isSelectionTag(tag("count", "variable"))).toBe(false);
    expect(isSelectionTag(tag("vitest", "library"))).toBe(false);
  });

  it("rejects names that are not bare identifiers", () => {
    expect(isSelectionTag(tag("a"))).toBe(false); // too short
    expect(isSelectionTag(tag("@smoke"))).toBe(false);
    expect(isSelectionTag(tag("node:fs"))).toBe(false);
    expect(isSelectionTag(tag("1auth"))).toBe(false);
  });

  it("rejects the category-echo markers", () => {
    expect(isSelectionTag(tag("test"))).toBe(false);
    expect(isSelectionTag(tag("barrel"))).toBe(false);
  });

  it("rejects built-in blocklisted generics (case-insensitive)", () => {
    expect(isSelectionTag(tag("index"))).toBe(false);
    expect(isSelectionTag(tag("Utils"))).toBe(false);
    expect(isSelectionTag(tag("linux"))).toBe(false); // Go platform token
    expect(isSelectionTag(tag("amd64"))).toBe(false);
  });
});

describe("configureTagQuality", () => {
  it("adds user blocklist entries on top of the built-in set", () => {
    configureTagQuality({ blocklist: ["widget", "LEGACY"] });
    expect(isSelectionTagName("widget")).toBe(false);
    expect(isSelectionTagName("legacy")).toBe(false);
    expect(isSelectionTagName("auth")).toBe(true);
    // built-ins still apply
    expect(isSelectionTagName("index")).toBe(false);
  });

  it("allowlist overrides both the built-in and the user blocklist", () => {
    configureTagQuality({ blocklist: ["auth"], allowlist: ["config", "auth"] });
    expect(isSelectionTagName("config")).toBe(true); // built-in blocklisted, allowlisted back
    expect(isSelectionTagName("auth")).toBe(true); // user-blocked, allowlisted back
  });

  it("resetTagQuality restores the built-in blocklist", () => {
    configureTagQuality({ allowlist: ["index"] });
    expect(isSelectionTagName("index")).toBe(true);
    resetTagQuality();
    expect(isSelectionTagName("index")).toBe(false);
  });

  it("undefined config is a no-op reset to built-ins", () => {
    configureTagQuality({ blocklist: ["widget"] });
    configureTagQuality(undefined);
    expect(isSelectionTagName("widget")).toBe(true);
    expect(isSelectionTagName("index")).toBe(false);
  });
});

describe("selectionTagNames", () => {
  it("returns distinct selection-quality names in first-seen order", () => {
    const names = selectionTagNames([
      tag("auth", "comment-marker"),
      tag("makeContext", "function"),
      tag("builder", "import"),
      tag("auth", "import"), // dup name
      tag("vitest", "library"),
      tag("test", "comment-marker"),
      tag("index", "import"),
    ]);
    expect(names).toEqual(["auth", "builder"]);
  });
});

describe("DEFAULT_TAG_BLOCKLIST", () => {
  it("is a frozen-ish curated set that includes the applier's former generics", () => {
    for (const name of ["utils", "helpers", "mocks", "fixtures", "setup", "types"]) {
      expect(DEFAULT_TAG_BLOCKLIST.has(name)).toBe(true);
    }
  });
});
