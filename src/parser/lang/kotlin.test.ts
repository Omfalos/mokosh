import { describe, expect, test } from "vitest";
import { parseKotlin } from "./kotlin";

/** Explicit `import` edges only — drops the synthetic same-package (`<pkg>.*`, side-effect) edge. */
const explicitSpecifiers = (imports: { rawSpecifier: string; type: string }[]) =>
  imports.filter((edge) => edge.type !== "side-effect").map((edge) => edge.rawSpecifier);

describe("parseKotlin imports", { tags: ["parseKotlin", "kotlin"] }, () => {
  test("plain, wildcard, and aliased imports", () => {
    const { imports } = parseKotlin(
      "src/main/kotlin/com/x/Repo.kt",
      `package com.x
import com.x.util.Helper
import com.x.data.*
import com.x.Foo as Bar
`,
    );
    expect(explicitSpecifiers(imports)).toEqual(["com.x.util.Helper", "com.x.data.*", "com.x.Foo"]);
    expect(imports.every((edge) => edge.isExternal === true)).toBe(true);
  });

  test("emits a synthetic same-package edge", () => {
    const { imports } = parseKotlin("src/main/kotlin/com/x/Repo.kt", `package com.x\nclass Repo`);
    expect(imports).toContainEqual(
      expect.objectContaining({ rawSpecifier: "com.x.*", type: "side-effect" }),
    );
  });

  test("commented-out import lines are ignored", () => {
    const { imports } = parseKotlin("A.kt", `// import com.x.Nope\nimport com.x.Yes\n`);
    expect(explicitSpecifiers(imports)).toEqual(["com.x.Yes"]);
  });
});

describe("parseKotlin exports", { tags: ["parseKotlin", "kotlin"] }, () => {
  test("top-level class / object / fun / val names", () => {
    const { exports } = parseKotlin(
      "A.kt",
      `class Repo
data class D(val a: Int)
object O
fun topFun() {}
val topVal = 1
`,
    );
    expect(exports.map((sym) => sym.name)).toEqual(["Repo", "D", "O", "topFun", "topVal"]);
  });

  test("indented (nested) members are not exported", () => {
    const { exports } = parseKotlin("A.kt", `class Repo {\n    fun method() {}\n}`);
    expect(exports.map((sym) => sym.name)).toEqual(["Repo"]);
  });

  test("extension function exports the function name, not the receiver type", () => {
    const { exports } = parseKotlin(
      "A.kt",
      `fun <T> Iterable<T>.asFlow(): Flow<T> = TODO()
fun String.toSlug(): String = this
inline fun <reified T> Map<String, T>.pick(key: String): T? = this[key]
`,
    );
    expect(exports.map((sym) => sym.name)).toEqual(["asFlow", "toSlug", "pick"]);
  });
});

describe("parseKotlin category", { tags: ["parseKotlin", "kotlin"] }, () => {
  test("androidTest source set is test", () => {
    expect(parseKotlin("app/src/androidTest/kotlin/com/x/T.kt", `class T`).category).toBe("test");
  });

  test("io.kotest import is test", () => {
    expect(
      parseKotlin("A.kt", `import io.kotest.core.spec.style.StringSpec\nclass A`).category,
    ).toBe("test");
  });

  test("@Composable function makes the file ui", () => {
    expect(
      parseKotlin("src/main/kotlin/com/x/Profile.kt", `@Composable\nfun Profile() {}`).category,
    ).toBe("ui");
  });

  test("a *ViewModel class name is ui", () => {
    expect(
      parseKotlin("src/main/kotlin/com/x/ProfileViewModel.kt", `class ProfileViewModel`).category,
    ).toBe("ui");
  });

  test("@Service annotation is logic, @Configuration is config", () => {
    expect(parseKotlin("src/main/kotlin/com/x/S.kt", `@Service\nclass S`).category).toBe("logic");
    expect(parseKotlin("src/main/kotlin/com/x/C.kt", `@Configuration\nobject C`).category).toBe(
      "config",
    );
  });
});
