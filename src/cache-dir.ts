/** Creation of mokosh's on-disk cache directory, kept out of the analysed repo's git status. */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CACHE_DIR } from "./const";

/**
 * @description Creates `dir` (and parents) and, when it lies inside a default-named
 *   `mokosh-cache/` directory, drops a `.gitignore` containing `*` in that cache root so the cache
 *   never shows up as untracked files (or gets swept up by `git add -A`) in the analysed repo.
 *   The ignore file is only ever written into a directory literally named after
 *   {@link DEFAULT_CACHE_DIR} — a custom `cachePath` pointing at the project root or any other
 *   shared directory is left alone, since ignoring `*` there would hide real files. An existing
 *   `.gitignore` is never overwritten.
 * @param {string} dir - Absolute or relative directory to create.
 * @returns {void}
 */
export function ensureCacheDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  let root = path.resolve(dir);
  while (path.basename(root) !== DEFAULT_CACHE_DIR) {
    const parent = path.dirname(root);
    if (parent === root) return;
    root = parent;
  }
  const ignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, "*\n");
}
