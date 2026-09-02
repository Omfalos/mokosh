import { describe, expect, test } from "vitest";
import { ScalaTestStrategy } from "./scalatest";

describe("ScalaTestStrategy", () => {
  const strategy = new ScalaTestStrategy();

  test("canHandle matches .scala test files by dir or name only", () => {
    expect(strategy.canHandle("/repo/src/test/scala/app/LoginSpec.scala")).toBe(true);
    expect(strategy.canHandle("/repo/src/main/scala/app/LoginSuite.scala")).toBe(true);
    expect(strategy.canHandle("/repo/src/main/scala/app/Login.scala")).toBe(false);
    expect(strategy.canHandle("/repo/src/test/java/app/LoginTest.java")).toBe(false);
  });

  test("inserts a managed marker comment above the suite", () => {
    const source = `package app

import org.scalatest.funsuite.AnyFunSuite

class LoginSpec extends AnyFunSuite {
}
`;
    const result = strategy.apply("/repo/src/test/scala/app/LoginSpec.scala", source, [
      "smoke",
      "auth",
    ]);
    expect(result).toBe(`package app

import org.scalatest.funsuite.AnyFunSuite

// mokosh:tags auth, smoke
class LoginSpec extends AnyFunSuite {
}
`);
  });

  test("replaces an existing marker in place", () => {
    const source = `// mokosh:tags old\nclass LoginSpec extends AnyFunSuite {\n}\n`;
    const result = strategy.apply("/repo/src/test/scala/app/LoginSpec.scala", source, ["auth"]);
    expect(result).toBe(`// mokosh:tags auth\nclass LoginSpec extends AnyFunSuite {\n}\n`);
  });

  test("is idempotent when tags already match", () => {
    const source = `// mokosh:tags auth, smoke\nclass LoginSpec extends AnyFunSuite {\n}\n`;
    expect(
      strategy.apply("/repo/src/test/scala/app/LoginSpec.scala", source, ["smoke", "auth"]),
    ).toBe(source);
  });

  test("removes the marker when tags is empty", () => {
    const source = `// mokosh:tags auth\nclass LoginSpec extends AnyFunSuite {\n}\n`;
    expect(strategy.apply("/repo/src/test/scala/app/LoginSpec.scala", source, [])).toBe(
      `class LoginSpec extends AnyFunSuite {\n}\n`,
    );
  });

  test("returns source unchanged when no declaration is found", () => {
    const source = `package app\n// nothing here\n`;
    expect(strategy.apply("/repo/src/test/scala/app/LoginSpec.scala", source, ["auth"])).toBe(
      source,
    );
  });
});
