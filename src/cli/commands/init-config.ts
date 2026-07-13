/** CLI command: scaffolds a starter mokosh.config.js into the current project. */
import fs from "node:fs";
import path from "node:path";
import { findTemplateDir } from "./template-dir";

/**
 * @description Copies the bundled `mokosh.config.js` template into the project root, so a
 *   user gets a commented starter config instead of hand-writing one from docs. Existing
 *   files are left untouched unless `force` is passed. The MCP server only reads
 *   `mokosh.config.json` (JS execution is disabled there), so this scaffolds a `.js` file
 *   aimed at CLI/programmatic use where comments and factory functions are supported.
 * @param {boolean} force - When true, overwrite the file if it already exists.
 * @param {string} cwd - Project directory to scaffold into (default: `process.cwd()`).
 */
export function runInitConfig(force: boolean, cwd: string = process.cwd()): void {
  const templateDir = findTemplateDir(__dirname, ["config"], "mokosh.config.js");
  const src = path.join(templateDir, "mokosh.config.js");
  const dest = path.join(cwd, "mokosh.config.js");

  if (fs.existsSync(dest) && !force) {
    console.log("skipped mokosh.config.js (already exists, use --force to overwrite)");
    return;
  }

  fs.copyFileSync(src, dest);
  console.log("wrote mokosh.config.js");
}
