import { describe, expect, test } from "vitest";
import { JUnitStrategy } from "./junit";

describe("JUnitStrategy", () => {
  const strategy = new JUnitStrategy();

  test("canHandle matches .java/.groovy/.kt test files by dir or name, nothing else", () => {
    expect(strategy.canHandle("/repo/src/test/java/app/LoginTest.java")).toBe(true);
    expect(strategy.canHandle("/repo/src/main/java/app/LoginTest.java")).toBe(true); // *Test name
    expect(strategy.canHandle("/repo/src/test/groovy/app/LoginSpec.groovy")).toBe(true);
    expect(strategy.canHandle("/repo/src/test/kotlin/app/LoginTest.kt")).toBe(true);
    expect(strategy.canHandle("/repo/src/androidTest/kotlin/app/LoginTest.kt")).toBe(true);
    expect(strategy.canHandle("/repo/src/main/java/app/Login.java")).toBe(false);
    expect(strategy.canHandle("/repo/src/main/kotlin/app/Login.kt")).toBe(false);
  });

  test("inserts a managed @Tag block and the Tag import", () => {
    const source = `package app;

import org.junit.jupiter.api.Test;

public class LoginTest {
}
`;
    const result = strategy.apply("/repo/src/test/java/app/LoginTest.java", source, ["auth"]);
    expect(result).toBe(`package app;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("auth")
public class LoginTest {
}
`);
  });

  test("joins multiple tags as repeatable @Tag lines, sorted", () => {
    const source = `package app;\nimport org.junit.jupiter.api.Test;\nclass LoginTest {\n}\n`;
    const result = strategy.apply("/repo/src/test/java/app/LoginTest.java", source, [
      "smoke",
      "auth",
    ]);
    expect(result).toContain('// mokosh:tags\n@Tag("auth")\n@Tag("smoke")\nclass LoginTest {');
  });

  test("replaces an existing managed block in place", () => {
    const source = `package app;
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("old")
public class LoginTest {
}
`;
    const result = strategy.apply("/repo/src/test/java/app/LoginTest.java", source, ["auth"]);
    expect(result).toContain('// mokosh:tags\n@Tag("auth")\npublic class LoginTest {');
    expect(result).not.toContain("old");
    // import already present → not duplicated
    expect(result.match(/import org\.junit\.jupiter\.api\.Tag;/g)).toHaveLength(1);
  });

  test("is idempotent when tags already match", () => {
    const source = `package app;
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("auth")
@Tag("smoke")
public class LoginTest {
}
`;
    expect(
      strategy.apply("/repo/src/test/java/app/LoginTest.java", source, ["smoke", "auth"]),
    ).toBe(source);
  });

  test("removes the block and the now-unused import when tags is empty", () => {
    const source = `package app;
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("auth")
public class LoginTest {
}
`;
    const result = strategy.apply("/repo/src/test/java/app/LoginTest.java", source, []);
    expect(result).toBe(`package app;

public class LoginTest {
}
`);
  });

  test("keeps the import on removal when @Tag is still used elsewhere", () => {
    const source = `package app;
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("auth")
public class LoginTest {
  @Tag("manual")
  void t() {}
}
`;
    const result = strategy.apply("/repo/src/test/java/app/LoginTest.java", source, []);
    expect(result).toContain("import org.junit.jupiter.api.Tag;");
    expect(result).not.toContain("// mokosh:tags");
  });

  test("returns source unchanged when no top-level type declaration is found", () => {
    const source = `package app;\n// just a comment\n`;
    expect(strategy.apply("/repo/src/test/java/app/LoginTest.java", source, ["auth"])).toBe(source);
  });

  describe("Kotlin", () => {
    test("inserts a managed @Tag block and the Tag import, no trailing semicolons", () => {
      const source = `package app

import org.junit.jupiter.api.Test

class LoginTest {
}
`;
      const result = strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, ["auth"]);
      expect(result).toBe(`package app

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Tag

// mokosh:tags
@Tag("auth")
class LoginTest {
}
`);
    });

    test("finds the declaration through Kotlin modifiers and a supertype clause", () => {
      const source = `package app\nimport org.junit.jupiter.api.Test\ninternal class LoginTest : BaseTest() {\n}\n`;
      const result = strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, ["smoke"]);
      expect(result).toContain(
        '// mokosh:tags\n@Tag("smoke")\ninternal class LoginTest : BaseTest() {',
      );
    });

    test("is idempotent when tags already match", () => {
      const source = `package app
import org.junit.jupiter.api.Tag

// mokosh:tags
@Tag("auth")
class LoginTest {
}
`;
      expect(strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, ["auth"])).toBe(
        source,
      );
    });

    test("removes the block and the now-unused import when tags is empty", () => {
      const source = `package app
import org.junit.jupiter.api.Tag

// mokosh:tags
@Tag("auth")
class LoginTest {
}
`;
      const result = strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, []);
      expect(result).toBe(`package app

class LoginTest {
}
`);
    });

    test("finds an enum class declaration", () => {
      const source = `package app\nimport org.junit.jupiter.api.Test\nenum class LoginTest {\n  A, B\n}\n`;
      const result = strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, ["auth"]);
      expect(result).toContain('// mokosh:tags\n@Tag("auth")\nenum class LoginTest {');
    });

    test("recognizes an existing semicolon-terminated Tag import instead of duplicating it", () => {
      const source = `package app
import org.junit.jupiter.api.Tag;

// mokosh:tags
@Tag("old")
class LoginTest {
}
`;
      const result = strategy.apply("/repo/src/test/kotlin/app/LoginTest.kt", source, ["auth"]);
      expect(result.match(/^import org\.junit\.jupiter\.api\.Tag;?$/gm)).toHaveLength(1);
    });
  });
});
