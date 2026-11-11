import { describe, expect, test } from "vitest";
import { type MokoshConfig, resolveDuplicationFlags } from "./config";

const config = (duplication: MokoshConfig["duplication"]): MokoshConfig =>
  ({ duplication }) as MokoshConfig;

describe("resolveDuplicationFlags", () => {
  test("defaults every flag to false with no scope when nothing is configured", () => {
    expect(resolveDuplicationFlags({}, undefined)).toEqual({
      includeGenerated: false,
      includeSameFile: false,
      includeSvgMarkup: false,
      includeDocs: false,
      scope: undefined,
      ignoreGlobs: [],
    });
  });

  test("config fills in what the caller left unspecified", () => {
    const flags = resolveDuplicationFlags(
      {},
      config({ includeDocs: true, scope: "all", ignoreGlobs: ["*.gen.ts"] }),
    );
    expect(flags).toMatchObject({ includeDocs: true, scope: "all", ignoreGlobs: ["*.gen.ts"] });
  });

  test("an explicit override beats config, including an explicit false", () => {
    const flags = resolveDuplicationFlags(
      { includeSameFile: false, scope: "tests" },
      config({ includeSameFile: true, scope: "src" }),
    );
    expect(flags.includeSameFile).toBe(false);
    expect(flags.scope).toBe("tests");
  });

  test("returns a copy of ignoreGlobs so callers cannot mutate the config", () => {
    const globs = ["a"];
    const flags = resolveDuplicationFlags({}, config({ ignoreGlobs: globs }));
    flags.ignoreGlobs.push("b");
    expect(globs).toEqual(["a"]);
  });
});
