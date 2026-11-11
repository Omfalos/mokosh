import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const runSpy = vi.hoisted(() => vi.fn());

// A stand-in pool that behaves like a worker thread: it only sees what is in the task payload.
vi.mock("piscina", async () => {
  const { parseFile } = await import("../parser.js");
  type Payload = { filePath: string; content: string; classifyConfig?: unknown };
  return {
    default: class {
      run = (payload: Payload) => {
        runSpy(payload);
        return parseFile(payload.filePath, payload.content, payload.classifyConfig as never);
      };
      destroy = async () => {};
    },
  };
});

import {
  registerConfigMatcher,
  registerTestPattern,
  resetClassifyRegistries,
} from "../parser/classify";
import { GraphBuilder } from "./builder";

let root: string;
beforeEach(() => {
  runSpy.mockClear();
  resetClassifyRegistries();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-pool-cfg-")));
  fs.writeFileSync(path.join(root, "thing.unit.js"), "export const a = 1;");
});
afterEach(() => {
  resetClassifyRegistries();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("pooled parsing carries the user's classification config", () => {
  test("a registered test pattern reaches the worker payload and classifies the file", async () => {
    registerTestPattern(".unit.");
    const graph = await new GraphBuilder(root, { parallelParsing: { minFiles: 1 } }).build([
      "thing.unit.js",
    ]);
    expect(runSpy).toHaveBeenCalled();
    expect(runSpy.mock.calls[0]?.[0].classifyConfig.testPatterns).toContain(".unit.");
    expect(graph.nodes.get("thing.unit.js")?.category).toBe("test");
  });

  test("predicate-function matchers are dropped from the payload with a warning", async () => {
    registerConfigMatcher((name: string) => name.startsWith("thing"));
    registerConfigMatcher(/^never-matches$/);
    const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await new GraphBuilder(root, { parallelParsing: { minFiles: 1 } }).build(["thing.unit.js"]);
      const payload = runSpy.mock.calls[0]?.[0].classifyConfig;
      expect(payload.configMatchers).toHaveLength(1);
      expect(warn.mock.calls.some(([msg]) => String(msg).includes("predicate-function"))).toBe(
        true,
      );
    } finally {
      warn.mockRestore();
    }
  });
});
