import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInitConfig } from "./init-config";

describe("runInitConfig", { tags: ["runInitConfig"] }, () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-init-config-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("writes mokosh.config.js on a fresh project", () => {
    runInitConfig(false, cwd);

    const configPath = path.join(cwd, "mokosh.config.js");

    expect(fs.existsSync(configPath)).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).toContain("module.exports");
  });

  it("does not overwrite an existing file without --force", () => {
    runInitConfig(false, cwd);
    const configPath = path.join(cwd, "mokosh.config.js");
    fs.writeFileSync(configPath, "custom content");

    runInitConfig(false, cwd);

    expect(fs.readFileSync(configPath, "utf-8")).toBe("custom content");
  });

  it("overwrites an existing file when --force is passed", () => {
    runInitConfig(false, cwd);
    const configPath = path.join(cwd, "mokosh.config.js");
    fs.writeFileSync(configPath, "custom content");

    runInitConfig(true, cwd);

    expect(fs.readFileSync(configPath, "utf-8")).toContain("module.exports");
  });
});
