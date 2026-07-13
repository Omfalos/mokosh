/** CLI command: scaffolds the bundled mokosh Claude Code skill/command into the current project. */
import fs from "node:fs";
import path from "node:path";
import { findTemplateDir } from "./template-dir";

interface Target {
  templateFile: string;
  destPath: string[];
}

const TARGETS: Target[] = [
  { templateFile: "SKILL.md", destPath: [".claude", "skills", "mokosh", "SKILL.md"] },
  { templateFile: "mokosh.md", destPath: [".claude", "commands", "mokosh.md"] },
];

/**
 * @description Copies the bundled mokosh skill (`SKILL.md`) and slash command (`mokosh.md`)
 *   templates into the target project's `.claude/` directory, so a downstream project's
 *   Claude Code picks up guidance on driving mokosh via MCP or CLI. Existing files are left
 *   untouched unless `force` is passed.
 * @param {boolean} force - When true, overwrite files that already exist at the destination.
 * @param {string} cwd - Project directory to scaffold into (default: `process.cwd()`).
 */
export function runInitSkill(force: boolean, cwd: string = process.cwd()): void {
  const templateDir = findTemplateDir(__dirname, ["skill"], "SKILL.md");

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
