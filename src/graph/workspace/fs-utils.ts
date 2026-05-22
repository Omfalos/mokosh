import fs from "node:fs";
import path from "node:path";

/** @description Returns `true` when `name` exists inside `root`. */
export function exists(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, name));
}

/** @description Returns `true` when `p` is an existing directory. Never throws. */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/** @description Returns `true` when `p` is an existing regular file. Never throws. */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}
