/** CLI command: scaffolds the bundled mokosh Claude Code skill/command into the current project. */
import fs from "node:fs";
import path from "node:path";

interface Target {
  templateFile: string;
  destPath: string[];
}

const TARGETS: Target[] = [
  { templateFile: "SKILL.md", destPath: [".claude", "skills", "mokosh", "SKILL.md"] },
  { templateFile: "mokosh.md", destPath: [".claude", "commands", "mokosh.md"] },
];

/**
 * @description Locates the bundled `templates/skill` directory by walking up from `startDir`.
 *   Templates live one level above the compiled `dist/cli.js` in the published package, but
 *   several levels above `src/cli/commands/` when running against source (tests, ts-node) —
 *   walking up avoids hardcoding either layout.
 * @param {string} startDir - Directory to start searching from (typically `__dirname`).
 * @returns {string} Absolute path to the `templates/skill` directory.
 */
function findTemplateDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "templates", "skill");
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate mokosh skill templates");
}

/**
 * @description Copies the bundled mokosh skill (`SKILL.md`) and slash command (`mokosh.md`)
 *   templates into the target project's `.claude/` directory, so a downstream project's
 *   Claude Code picks up guidance on driving mokosh via MCP or CLI. Existing files are left
 *   untouched unless `force` is passed.
 * @param {boolean} force - When true, overwrite files that already exist at the destination.
 * @param {string} cwd - Project directory to scaffold into (default: `process.cwd()`).
 */
export function runInitSkill(force: boolean, cwd: string = process.cwd()): void {
  const templateDir = findTemplateDir(__dirname);

  for (const target of TARGETS) {
    const src = path.join(templateDir, target.templateFile);
    const dest = path.join(cwd, ...target.destPath);
    const relDest = path.join(...target.destPath);

    if (fs.existsSync(dest) && !force) {
      console.log(`skipped ${relDest} (already exists, use --force to overwrite)`);
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`wrote ${relDest}`);
  }
}
