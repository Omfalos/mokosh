
import fs from "node:fs";
import path from "node:path";

/**
 * @description Returns `true` when `name` exists inside `root`.
 * @param {string} root - Absolute directory path to search within.
 * @param {string} name - File or directory name to look for.
 * @returns {boolean} `true` if the entry exists, `false` otherwise.
 */
export function exists(root: string, name: string): boolean {
  return fs.existsSync(path.join(root, name));
}

/**
 * @description Returns `true` when `p` is an existing directory. Never throws.
 * @param {string} p - Absolute path to test.
 * @returns {boolean} `true` if the path exists and is a directory.
 */
export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/**
 * @description Returns `true` when `p` is an existing regular file. Never throws.
 * @param {string} p - Absolute path to test.
 * @returns {boolean} `true` if the path exists and is a regular file.
 */
export function isFile(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;
  } catch {
    return false;
  }
}
