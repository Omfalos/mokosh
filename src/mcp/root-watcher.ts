import fs, { type FSWatcher } from "node:fs";
import { IGNORE_WATCH } from "../watch-ignore";

/**
 * @description Watches project roots and tracks which are "dirty" (a source file changed since the
 *   last consumer cleared the flag), so the next query can trigger an incremental rebuild.
 */
export class RootWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly dirtyRoots = new Set<string>();

  /**
   * @description Starts a recursive `fs.watch` on `root` (ignoring `IGNORE_WATCH` paths). Safe to
   *   call repeatedly — a second call for the same root is a no-op; unsupported filesystems
   *   degrade silently.
   * @param root - Absolute path of the directory to watch.
   */
  start(root: string): void {
    if (this.watchers.has(root)) return;
    try {
      const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename || IGNORE_WATCH.test(filename)) return;
        this.dirtyRoots.add(root);
      });
      watcher.on("error", () => {
        this.watchers.delete(root);
      });
      this.watchers.set(root, watcher);
    } catch {
      // Degrade gracefully on unsupported filesystems or permission errors.
    }
  }

  /** @param root - Absolute project root. @returns Whether `root` changed since last cleared. */
  isDirty(root: string): boolean {
    return this.dirtyRoots.has(root);
  }

  /** @description Clears `root`'s dirty flag. @param root - Absolute project root. */
  clearDirty(root: string): void {
    this.dirtyRoots.delete(root);
  }
}
