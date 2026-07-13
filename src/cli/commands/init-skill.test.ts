import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInitSkill } from "./init-skill";

describe("runInitSkill", { tags: ["runInitSkill"] }, () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-init-skill-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writes the skill and command files on a fresh project", () => {
    runInitSkill(false, cwd);

    const skillPath = path.join(cwd, ".claude", "skills", "mokosh", "SKILL.md");
    const commandPath = path.join(cwd, ".claude", "commands", "mokosh.md");

    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toContain("name: mokosh");
  });

  it("does not overwrite an existing file without --force", () => {
    runInitSkill(false, cwd);
    const skillPath = path.join(cwd, ".claude", "skills", "mokosh", "SKILL.md");
    fs.writeFileSync(skillPath, "custom content");

    runInitSkill(false, cwd);

    expect(fs.readFileSync(skillPath, "utf-8")).toBe("custom content");
  });

  it("overwrites an existing file when --force is passed", () => {
    runInitSkill(false, cwd);
    const skillPath = path.join(cwd, ".claude", "skills", "mokosh", "SKILL.md");
    fs.writeFileSync(skillPath, "custom content");

    runInitSkill(true, cwd);

    expect(fs.readFileSync(skillPath, "utf-8")).toContain("name: mokosh");
  });
});
