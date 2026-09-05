import { describe, expect, it } from "vitest";
import type { FileType } from "../../types/parse";
import { getDuplicateFamily } from "./families";

describe("getDuplicateFamily", { tags: ["duplication"] }, () => {
  it("keeps JS and TS in one family so JS↔TS ports still match", () => {
    expect(getDuplicateFamily("javascript")).toBe("js");
    expect(getDuplicateFamily("typescript")).toBe("js");
    expect(getDuplicateFamily("coffeescript")).toBe("js");
    expect(getDuplicateFamily("livescript")).toBe("js");
  });

  it("isolates the JVM languages from JS", () => {
    for (const type of ["java", "kotlin", "scala", "groovy"] as const) {
      expect(getDuplicateFamily(type)).toBe("jvm");
    }
    expect(getDuplicateFamily("java")).not.toBe(getDuplicateFamily("typescript"));
  });

  it("gives Python, Go and Lua their own families", () => {
    expect(getDuplicateFamily("python")).toBe("python");
    expect(getDuplicateFamily("go")).toBe("go");
    expect(getDuplicateFamily("lua")).toBe("lua");
  });

  it("keeps every CSS-family type (incl. Stylus) in 'style'", () => {
    for (const type of ["css", "scss", "less", "stylus"] as const) {
      expect(getDuplicateFamily(type)).toBe("style");
    }
  });

  it("separates prose/DSL from code", () => {
    expect(getDuplicateFamily("markdown")).toBe("markdown");
    expect(getDuplicateFamily("gherkin")).toBe("gherkin");
    expect(getDuplicateFamily("markdown")).not.toBe(getDuplicateFamily("typescript"));
  });

  it("falls back to 'other' for an unmapped type", () => {
    expect(getDuplicateFamily("unknown")).toBe("other");
    expect(getDuplicateFamily("made-up" as FileType)).toBe("other");
  });
});
