/**
 * Tag applier strategy for Jest: writes a `@group` docblock pragma at the top of the file.
 * Jest has no built-in tag/grep mechanism; `jest-runner-groups` is the de-facto standard for
 * file-level tag filtering, reading a `/** @group tagname *\/` docblock above the imports.
 *
 * Example output:
 *   /**
 *    * @group auth
 *    * @group parseArgs
 *    *\/
 *   import { describe, test } from "@jest/globals";
 *
 * Filter at CI time with: `jest --group=auth`
 * Requires: `npm install --save-dev jest-runner-groups` and `runner: "jest-runner-groups"` in
 * the Jest config.
 * @see https://github.com/facebook-atom/jest-runner-groups
 */
import path from "node:path";
import { TS_EXTENSIONS } from "./ts-ast-utils";
import type { TagApplierStrategy } from "./types";

const GROUP_BLOCK_RE = /^\/\*\*\n(?: \* @group .+\n)+ \*\/\n+/;
const GROUP_LINE_RE = /^ \* @group (.+)$/gm;

function buildBlock(tags: string[]): string {
  return ["/**", ...tags.map((tag) => ` * @group ${tag}`), " */"].join("\n") + "\n\n";
}

function readExistingGroups(block: string): string[] {
  const found: string[] = [];
  GROUP_LINE_RE.lastIndex = 0;
  let match = GROUP_LINE_RE.exec(block);
  while (match !== null) {
    if (match[1]) found.push(match[1]);
    match = GROUP_LINE_RE.exec(block);
  }
  return found;
}

export class JestStrategy implements TagApplierStrategy {
  readonly name = "jest";

  canHandle(absPath: string): boolean {
    return TS_EXTENSIONS.has(path.extname(absPath).toLowerCase());
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const match = GROUP_BLOCK_RE.exec(source);
    const existing = match ? readExistingGroups(match[0]) : null;
    const sortedTags = [...tags].sort();

    if (existing !== null && JSON.stringify([...existing].sort()) === JSON.stringify(sortedTags)) {
      return source;
    }

    const stripped = match ? source.slice(match[0].length) : source;

    if (tags.length === 0) return stripped;

    return buildBlock(sortedTags) + stripped;
  }
}
