import { describe, expect, test } from "vitest";
import { GherkinStrategy } from "./gherkin";

describe("GherkinStrategy", () => {
  const strategy = new GherkinStrategy();

  test("canHandle matches only .feature files", () => {
    expect(strategy.canHandle("/repo/login.feature")).toBe(true);
    expect(strategy.canHandle("/repo/login.test.ts")).toBe(false);
  });

  test("inserts a mokosh-tags block before the Feature: line", () => {
    const source = "Feature: Login\n  Scenario: works\n";
    const result = strategy.apply("/repo/login.feature", source, ["auth", "smoke"]);
    expect(result).toBe(
      "# <mokosh-tags>\n@auth\n@smoke\n# </mokosh-tags>\n\nFeature: Login\n  Scenario: works\n",
    );
  });

  test("replaces an existing mokosh-tags block in place", () => {
    const source = "# <mokosh-tags>\n@old\n# </mokosh-tags>\n\nFeature: Login\n";
    const result = strategy.apply("/repo/login.feature", source, ["auth"]);
    expect(result).toBe("# <mokosh-tags>\n@auth\n# </mokosh-tags>\n\nFeature: Login\n");
  });

  test("skips tags already present as native @tag lines outside the managed block", () => {
    const source = "@auth\nFeature: Login\n";
    const result = strategy.apply("/repo/login.feature", source, ["auth", "smoke"]);
    expect(result).toBe("@auth\n# <mokosh-tags>\n@smoke\n# </mokosh-tags>\n\nFeature: Login\n");
  });

  test("removes the managed block when tags is empty", () => {
    const source = "# <mokosh-tags>\n@auth\n# </mokosh-tags>\n\nFeature: Login\n";
    const result = strategy.apply("/repo/login.feature", source, []);
    expect(result).toBe("Feature: Login\n");
  });

  test("returns source unchanged when there is nothing to add or remove", () => {
    const source = "Feature: Login\n";
    const result = strategy.apply("/repo/login.feature", source, []);
    expect(result).toBe(source);
  });
});
