import { describe, expect, test } from "vitest";
import { GoStrategy } from "./go";

describe("GoStrategy", () => {
  const strategy = new GoStrategy();

  test("canHandle matches only *_test.go files", () => {
    expect(strategy.canHandle("/repo/login_test.go")).toBe(true);
    expect(strategy.canHandle("/repo/login.go")).toBe(false);
    expect(strategy.canHandle("/repo/login_test.ts")).toBe(false);
  });

  test("inserts a //go:build constraint before the package declaration", () => {
    const source = "package main\n\nfunc TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, ["auth"]);
    expect(result).toBe(
      "//go:build mokosh_auth\n\npackage main\n\nfunc TestLogin(t *testing.T) {}\n",
    );
  });

  test("joins multiple tags with OR semantics", () => {
    const source = "package main\n\nfunc TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, ["auth", "smoke"]);
    expect(result).toBe(
      "//go:build mokosh_auth || mokosh_smoke\n\npackage main\n\nfunc TestLogin(t *testing.T) {}\n",
    );
  });

  test("updates an existing mokosh build tag line in place", () => {
    const source = "//go:build mokosh_old\npackage main\n\nfunc TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, ["auth"]);
    expect(result).toBe(
      "//go:build mokosh_auth\npackage main\n\nfunc TestLogin(t *testing.T) {}\n",
    );
  });

  test("is idempotent when tags already match", () => {
    const source =
      "//go:build mokosh_auth || mokosh_smoke\npackage main\n\nfunc TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, ["smoke", "auth"]);
    expect(result).toBe(source);
  });

  test("removes the build tag line when tags is empty", () => {
    const source = "//go:build mokosh_auth\npackage main\n\nfunc TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, []);
    expect(result).toBe("package main\n\nfunc TestLogin(t *testing.T) {}\n");
  });

  test("returns source unchanged when there is no package declaration", () => {
    const source = "func TestLogin(t *testing.T) {}\n";
    const result = strategy.apply("/repo/login_test.go", source, ["auth"]);
    expect(result).toBe(source);
  });
});
