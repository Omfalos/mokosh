/** Long-running `--watch` mode: re-runs a command whenever a source file changes, debounced. */
import fs from "node:fs";
import { IGNORE_WATCH } from "../watch-ignore";

/**
 * @description Runs `rerun` immediately, then again on every debounced batch of file changes under
 *   `rootDir` (ignoring `node_modules`/`.git`/`dist`/`build`/`coverage`, matching the MCP session
 *   cache's watch behavior). Overlapping triggers collapse into a single trailing re-run. Never
 *   returns on its own — the process stays alive until `SIGINT` closes the watcher and exits.
 * @param {string} rootDir - Absolute path of the directory to watch.
 * @param {number} debounceMs - Milliseconds to wait after the last change before re-running.
 * @param {() => Promise<void>} rerun - Rebuilds the graph and re-invokes the command handler.
 */
export function watchAndRun(rootDir: string, debounceMs: number, rerun: () => Promise<void>): void {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let pending = false;

  const trigger = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await rerun();
    } finally {
      running = false;
      if (pending) {
        pending = false;
        void trigger();
      }
    }
  };

  void trigger();

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(rootDir, { recursive: true }, (_event, filename) => {
      if (!filename || IGNORE_WATCH.test(filename)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void trigger();
      }, debounceMs);
    });
  } catch (err) {
    console.error(`Warning: unable to watch ${rootDir}: ${(err as Error).message}`);
  }

  process.on("SIGINT", () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
    process.exit(0);
  });
}
