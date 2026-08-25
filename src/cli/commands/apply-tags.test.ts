import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Graph } from "../../index";
import { run } from "./apply-tags";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("apply-tags command", { tags: ["apply-tags"] }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a dry-run message and a no-op result when the graph has no test files", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), dryRun: true }));

    expect(logSpy).toHaveBeenCalledWith("Dry run: computing tag changes...");
    const result = JSON.parse(logSpy.mock.calls[1]?.[0] as string);
    expect(result).toEqual({ updated: 0, unchanged: 0, errors: 0, files: [] });
  });

  it("prints the apply-mode message instead of dry-run when --dry-run is false", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), dryRun: false }));

    expect(logSpy).toHaveBeenCalledWith("Applying tags to test files...");
  });

  it("suppresses the progress message with --plain", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), dryRun: true, plain: true }));

    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  describe("with an empty graph", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-apply-tags-"));
      fs.writeFileSync(
        path.join(dir, "sample.test.ts"),
        "import { it } from 'vitest';\nit('works', () => {});\n",
      );
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("scans for test files under rootDir before applying tags", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await run(makeContext({ graph: new Graph(new Map()), rootDir: dir, dryRun: true }));

      const result = JSON.parse(logSpy.mock.calls[1]?.[0] as string);
      expect(result.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining("sample.test.ts") }),
        ]),
      );
    });
  });
});
