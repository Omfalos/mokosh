import { describe, expect, test } from "vitest";
import { parseJava } from "./java";

/** Explicit `import` edges only — drops the synthetic same-package (`<pkg>.*`, side-effect) edge. */
const explicitSpecifiers = (imports: { rawSpecifier: string; type: string }[]) =>
  imports.filter((edge) => edge.type !== "side-effect").map((edge) => edge.rawSpecifier);

describe("parseJava imports", { tags: ["parseJava", "java"] }, () => {
  test("plain, wildcard, and static imports", () => {
    const { imports } = parseJava(
      "src/main/java/com/x/Repo.java",
      `package com.x;
import com.x.util.Helper;
import com.x.data.*;
import static com.x.Consts.MAX;
class Repo {}
`,
    );
    expect(explicitSpecifiers(imports)).toEqual([
      "com.x.util.Helper",
      "com.x.data.*",
      "com.x.Consts",
    ]);
    expect(imports.every((edge) => edge.isExternal === true)).toBe(true);
  });

  test("emits a synthetic same-package edge from the file's own package", () => {
    const { imports } = parseJava("src/main/java/com/x/Repo.java", `package com.x;\nclass Repo {}`);
    expect(imports).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "com.x.*",
        type: "side-effect",
        isSamePackage: true,
      }),
    );
  });

  test("static wildcard keeps the type FQN", () => {
    const { imports } = parseJava(
      "A.java",
      `import static com.x.Consts.*;
class A {}`,
    );
    expect(explicitSpecifiers(imports)).toEqual(["com.x.Consts"]);
  });

  test("the package declaration is not emitted as an explicit import edge", () => {
    const { imports } = parseJava("A.java", `package com.x.y.z;\nclass A {}`);
    expect(explicitSpecifiers(imports)).toHaveLength(0);
  });

  test("a file with no package declaration gets no synthetic edge", () => {
    const { imports } = parseJava("A.java", `class A {}`);
    expect(imports).toHaveLength(0);
  });
});

describe("parseJava exports", { tags: ["parseJava", "java"] }, () => {
  test("top-level class / interface / enum names", () => {
    const { exports } = parseJava(
      "A.java",
      `class A {}
interface B {}
enum C { X }
`,
    );
    expect(exports.map((sym) => sym.name)).toEqual(["A", "B", "C"]);
  });

  test("nested types are not exported", () => {
    const { exports } = parseJava("A.java", `class A { class Inner {} }`);
    expect(exports.map((sym) => sym.name)).toEqual(["A"]);
  });
});

describe("parseJava tags & category", { tags: ["parseJava", "java"] }, () => {
  test("// @tag markers are collected", () => {
    const { tags } = parseJava("A.java", `// @tag core\nclass A {}`);
    expect(tags).toEqual([{ name: "core", kind: "comment-marker" }]);
  });

  test("files under src/test are categorised as test", () => {
    expect(parseJava("app/src/test/java/com/x/AT.java", `class AT {}`).category).toBe("test");
  });

  test("importing org.junit categorises as test", () => {
    const { category } = parseJava("A.java", `import org.junit.jupiter.api.Test;\nclass A {}`);
    expect(category).toBe("test");
  });

  test("plain source file is logic", () => {
    expect(parseJava("src/main/java/com/x/A.java", `class A {}`).category).toBe("logic");
  });

  test("@Service / @RestController stereotypes are logic", () => {
    expect(
      parseJava("src/main/java/com/x/UserService.java", `@Service\nclass UserService {}`).category,
    ).toBe("logic");
  });

  test("@Configuration is config", () => {
    expect(
      parseJava("src/main/java/com/x/AppConfig.java", `@Configuration\nclass AppConfig {}`)
        .category,
    ).toBe("config");
  });

  test("a *ViewModel / *Activity type name is ui", () => {
    expect(
      parseJava("src/main/java/com/x/ProfileViewModel.java", `class ProfileViewModel {}`).category,
    ).toBe("ui");
  });

  test("test source set still wins over an annotation", () => {
    expect(
      parseJava("app/src/test/java/com/x/AppConfig.java", `@Configuration\nclass AppConfig {}`)
        .category,
    ).toBe("test");
  });

  test("a TestNG / AssertJ import categorises as test", () => {
    expect(
      parseJava("src/main/java/com/x/A.java", `import org.testng.annotations.Test;\nclass A {}`)
        .category,
    ).toBe("test");
    expect(
      parseJava(
        "src/main/java/com/x/B.java",
        `import static org.assertj.core.api.Assertions.assertThat;\nclass B {}`,
      ).category,
    ).toBe("test");
  });

  test("a *Test / *IT file name outside a test root is a weak test signal", () => {
    expect(parseJava("libs/foo/com/x/PaymentIT.java", `class PaymentIT {}`).category).toBe("test");
    expect(parseJava("libs/foo/com/x/OrderTest.java", `class OrderTest {}`).category).toBe("test");
    expect(parseJava("libs/foo/com/x/OrderService.java", `class OrderService {}`).category).toBe(
      "logic",
    );
  });
});
