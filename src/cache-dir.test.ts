import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ensureCacheDir } from "./cache-dir";

const tmp: string[] = [];
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-cachedir-"));
  tmp.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("ensureCacheDir", { tags: ["cache"] }, () => {
  test("writes a self-ignoring .gitignore into the mokosh-cache root", () => {
    const root = mk();
    ensureCacheDir(path.join(root, "mokosh-cache", "workspace"));
    expect(fs.readFileSync(path.join(root, "mokosh-cache", ".gitignore"), "utf8")).toBe("*\n");
  });

  test("never overwrites an existing .gitignore", () => {
    const root = mk();
    fs.mkdirSync(path.join(root, "mokosh-cache"));
    fs.writeFileSync(path.join(root, "mokosh-cache", ".gitignore"), "custom\n");
    ensureCacheDir(path.join(root, "mokosh-cache"));
    expect(fs.readFileSync(path.join(root, "mokosh-cache", ".gitignore"), "utf8")).toBe("custom\n");
  });

  test("leaves a custom-named directory (e.g. the project root) alone", () => {
    const root = mk();
    ensureCacheDir(root);
    ensureCacheDir(path.join(root, "custom-cache"));
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(root, "custom-cache", ".gitignore"))).toBe(false);
  });
});
