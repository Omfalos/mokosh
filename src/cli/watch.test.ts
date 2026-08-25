import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchAndRun } from "./watch";

describe("watchAndRun", { tags: ["watchAndRun"] }, () => {
  let dir: string;
  const watchers: fs.FSWatcher[] = [];
  const originalWatch = fs.watch;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-watch-"));
    // Track every watcher this test creates so it can be closed in afterEach — watchAndRun
    // itself only closes on SIGINT, which would otherwise leak an open handle per test.
    vi.spyOn(fs, "watch").mockImplementation((...args: Parameters<typeof fs.watch>) => {
      const watcher = (originalWatch as (...a: Parameters<typeof fs.watch>) => fs.FSWatcher)(
        ...args,
      );
      watchers.push(watcher);
      return watcher;
    });
  });

  afterEach(() => {
    for (const watcher of watchers.splice(0)) watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs the callback immediately on start", () => {
    const rerun = vi.fn().mockResolvedValue(undefined);

    watchAndRun(dir, 10, rerun);

    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it("debounces a burst of file changes into a single re-run", async () => {
    const rerun = vi.fn().mockResolvedValue(undefined);
    watchAndRun(dir, 30, rerun);
    // flush the immediate initial call
    await vi.waitFor(() => expect(rerun).toHaveBeenCalledTimes(1));

    fs.writeFileSync(path.join(dir, "a.ts"), "1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    fs.writeFileSync(path.join(dir, "a.ts"), "2");

    await vi.waitFor(() => expect(rerun).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it("warns instead of throwing when the directory can't be watched", () => {
    vi.mocked(fs.watch).mockImplementation(() => {
      throw new Error("EMFILE: too many open files");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rerun = vi.fn().mockResolvedValue(undefined);

    expect(() => watchAndRun(dir, 10, rerun)).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("unable to watch"));
  });
});
