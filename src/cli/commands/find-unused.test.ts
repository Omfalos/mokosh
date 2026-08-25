import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./find-unused";
import { makeContext, makeFixtureGraph } from "./test-context";

describe("find-unused command", { tags: ["find-unused"] }, () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-find-unused-"));
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(dir, "b.ts"), "export const b = 1;\n");
    fs.writeFileSync(path.join(dir, "orphan.test.ts"), "import { it } from 'vitest';\n");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("lists project files with no incoming imports", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), rootDir: dir }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    // makeFixtureGraph's src/a.ts and src/b.ts aren't project files under `dir`, so every
    // real file on disk (a.ts, b.ts, orphan.test.ts) is unreachable and reported unused.
    expect(output.unusedFiles.sort()).toEqual(["a.ts", "b.ts", "orphan.test.ts"].sort());
  });

  it("excludes test/story files when --exclude-tests is set", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await run(makeContext({ graph: makeFixtureGraph(), rootDir: dir, excludeTests: true }));

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.unusedFiles.sort()).toEqual(["a.ts", "b.ts"]);
  });
});
