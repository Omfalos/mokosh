import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./detect-features";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("detect-features command", { tags: ["detect-features"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects nothing above the default threshold on the small fixture graph", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph() }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.features).toEqual([]);
  });

  it("honors --feature-threshold to lower the hub bar", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), featureThreshold: 1 }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.features).toEqual([expect.objectContaining({ path: "src/b.ts", outDegree: 1 })]);
  });

  describe("with an empty graph", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-detect-features-"));
      fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("scans the project from rootDir before detecting features", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await run(makeContext({ graph: new Graph(new Map()), rootDir: dir }));

      const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
      expect(output.features).toEqual([]);
    });
  });
});
