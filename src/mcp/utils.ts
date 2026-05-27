import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TextResponse = { content: [{ type: "text"; text: string }] };

/** Wraps any JSON-serializable value as an MCP text content response block. */
export function text(data: unknown): TextResponse {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/**
 * @description Validates that `root` is an absolute path within the user's home directory and points to an existing directory.
 *   Called once per request before any tool handler runs, so handlers never receive an out-of-bounds root.
 * @param {string} root - The project root path supplied by the MCP caller.
 * @throws {Error} with a generic message if any constraint is violated — messages are intentionally vague to avoid leaking filesystem structure.
 */
export function validateRoot(root: string): void {
  if (!path.isAbsolute(root)) {
    throw new Error("root must be an absolute path");
  }
  const resolved = path.resolve(root);
  const home = os.homedir();
  if (resolved !== home && !resolved.startsWith(home + path.sep)) {
    throw new Error("root must be within the user home directory");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error("root does not exist");
  }
  if (!stat.isDirectory()) {
    throw new Error("root is not a directory");
  }
}
