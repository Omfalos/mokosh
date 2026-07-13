/** Shared helper for locating bundled `templates/` subdirectories from a compiled or source layout. */
import fs from "node:fs";
import path from "node:path";

/**
 * @description Locates a bundled `templates/<subpath>` directory by walking up from `startDir`,
 *   checking for `markerFile` at each level. Templates live one level above the compiled
 *   `dist/cli.js` in the published package, but several levels above `src/cli/commands/` when
 *   running against source (tests, ts-node) — walking up avoids hardcoding either layout.
 * @param {string} startDir - Directory to start searching from (typically `__dirname`).
 * @param {string[]} subpathSegments - Path segments under `templates/` to locate, e.g. `["skill"]`.
 * @param {string} markerFile - Filename within the target directory used to confirm it was found.
 * @returns {string} Absolute path to the located `templates/<subpath>` directory.
 */
export function findTemplateDir(
  startDir: string,
  subpathSegments: string[],
  markerFile: string,
): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "templates", ...subpathSegments);
    if (fs.existsSync(path.join(candidate, markerFile))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate mokosh templates/${subpathSegments.join("/")}`);
}
