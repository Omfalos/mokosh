/**
 * Tag applier strategy for Gherkin .feature files: writes a `# <mokosh-tags>` comment block
 * with native `@tagname` lines before the Feature: declaration.
 */
import path from "node:path";
import type { TagApplierStrategy } from "./types";

const BLOCK_REGEX = /# <mokosh-tags>[\s\S]*?# <\/mokosh-tags>\n*/;
const EXISTING_TAG_REGEX = /^@([a-zA-Z0-9_-]+)/gm;

function buildBlock(tags: string[]): string {
  return (
    ["# <mokosh-tags>", ...tags.map((tag) => `@${tag}`), "# </mokosh-tags>"].join("\n") + "\n\n"
  );
}

function readManualTags(content: string): Set<string> {
  const found = new Set<string>();
  EXISTING_TAG_REGEX.lastIndex = 0;
  let match = EXISTING_TAG_REGEX.exec(content);
  while (match !== null) {
    if (match[1]) found.add(match[1]);
    match = EXISTING_TAG_REGEX.exec(content);
  }
  return found;
}

export class GherkinStrategy implements TagApplierStrategy {
  readonly name = "gherkin";

  canHandle(absPath: string): boolean {
    return path.extname(absPath).toLowerCase() === ".feature";
  }

  apply(_absPath: string, source: string, tags: string[]): string {
    const manualContent = source.replace(BLOCK_REGEX, "");
    const manualTags = readManualTags(manualContent);
    const netNewTags = tags.filter((tag) => !manualTags.has(tag));

    const newBlock = netNewTags.length > 0 ? buildBlock(netNewTags) : "";

    if (BLOCK_REGEX.test(source)) {
      return source.replace(BLOCK_REGEX, newBlock);
    }
    if (newBlock) {
      return source.replace(/^(Feature:)/m, `${newBlock}$1`);
    }
    return source;
  }
}
