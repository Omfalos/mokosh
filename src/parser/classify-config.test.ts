import { describe, expect, test } from "vitest";
import parseInWorker from "../parse-worker";
import { parseFile } from "../parser";
import {
  type ClassifyConfig,
  getClassifyConfig,
  resetClassifyRegistries,
  toTransferableClassifyConfig,
} from "./classify";

const base: ClassifyConfig = {
  testPatterns: [],
  testLibraries: [],
  configMatchers: [],
  barrelThreshold: 0.8,
};

describe("explicit ClassifyConfig", () => {
  test("a user test pattern in the explicit config classifies without touching global registries", async () => {
    resetClassifyRegistries();
    const result = await parseFile("src/foo.unit.ts", "export const a = 1;", {
      ...base,
      testPatterns: [".unit."],
    });
    expect(result.category).toBe("test");
    expect(getClassifyConfig().testPatterns).toEqual([]);
  });

  test("a lower barrelThreshold in the explicit config reclassifies a mixed file as a barrel", async () => {
    resetClassifyRegistries();
    const source = "export * from './a';\nexport * from './b';\nconst x = 1;\nconst y = 2;\n";
    expect((await parseFile("src/m.ts", source, base)).category).toBe("logic");
    expect((await parseFile("src/m.ts", source, { ...base, barrelThreshold: 0.4 })).category).toBe(
      "barrel",
    );
  });

  test("the worker handler honours the config carried in its payload", async () => {
    resetClassifyRegistries();
    const result = await parseInWorker({
      filePath: "src/foo.unit.ts",
      content: "export const a = 1;",
      classifyConfig: { ...base, testPatterns: [".unit."] },
    });
    expect(result.category).toBe("test");
  });

  test("toTransferableClassifyConfig drops predicate matchers but keeps strings and RegExps", () => {
    const { config, droppedMatchers } = toTransferableClassifyConfig({
      ...base,
      configMatchers: [".my.", /^vite\./, (name) => name.startsWith("jest")],
    });
    expect(droppedMatchers).toBe(1);
    expect(config.configMatchers).toHaveLength(2);
    expect(() => structuredClone(config)).not.toThrow();
  });
});
