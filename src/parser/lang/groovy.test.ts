import { describe, expect, test } from "vitest";
import { parseGroovy } from "./groovy";

/** Explicit `import` edges only — drops the synthetic same-package (`<pkg>.*`, side-effect) edge. */
const explicitSpecifiers = (imports: { rawSpecifier: string; type: string }[]) =>
  imports.filter((edge) => edge.type !== "side-effect").map((edge) => edge.rawSpecifier);

describe("parseGroovy imports", { tags: ["parseGroovy", "groovy"] }, () => {
  test("plain, wildcard, static-member, and static-wildcard imports", () => {
    const { imports } = parseGroovy(
      "src/main/groovy/com/x/Task.groovy",
      `package com.x
import com.x.util.Helper
import com.x.data.*
import static com.x.Consts.MAX
import static com.x.More.*
`,
    );
    expect(explicitSpecifiers(imports)).toEqual([
      "com.x.util.Helper",
      "com.x.data.*",
      "com.x.Consts",
      "com.x.More",
    ]);
  });

  test("emits a synthetic same-package edge", () => {
    const { imports } = parseGroovy(
      "src/main/groovy/com/x/Task.groovy",
      `package com.x\nclass Task {}`,
    );
    expect(imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "com.x.*", type: "side-effect" }),
    );
  });
});

describe("parseGroovy exports & category", { tags: ["parseGroovy", "groovy"] }, () => {
  test("top-level class / trait / def names are exports", () => {
    const { exports } = parseGroovy(
      "s.groovy",
      `class A {}
trait B {}
def helper() {}
`,
    );
    expect(exports.map((sym) => sym.name)).toEqual(["A", "B", "helper"]);
  });

  test("a .gradle build script is categorised as config", () => {
    expect(parseGroovy("app/build.gradle", `dependencies { }`).category).toBe("config");
  });

  test("a plain .groovy source file is logic", () => {
    expect(parseGroovy("src/main/groovy/com/x/A.groovy", `class A {}`).category).toBe("logic");
  });

  test("spock spec is categorised as test", () => {
    const { category } = parseGroovy(
      "src/test/groovy/com/x/ASpec.groovy",
      `import spock.lang.Specification\nclass ASpec extends Specification {}`,
    );
    expect(category).toBe("test");
  });

  test("@Service annotation is logic (not shallow default)", () => {
    expect(parseGroovy("src/main/groovy/com/x/S.groovy", `@Service\nclass S {}`).category).toBe(
      "logic",
    );
  });
});
