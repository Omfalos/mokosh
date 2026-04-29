import { parseCodeFile } from "./parser/code";
import { parseCoffeeScript } from "./parser/coffee";
import { getFileType } from "./parser/file-type";
import { parseGherkin } from "./parser/gherkin";
import { parseLiveScript } from "./parser/ls";
import { parseLua } from "./parser/lua";
import { getParserForType, registerParser } from "./parser/registry";
import { parseStyleFile } from "./parser/style";
import type { ParseResult } from "./parser/types";
import type { ImportEdge } from "./types";

// Register default parsers
registerParser("javascript", (path, content) => parseCodeFile(path, content, "javascript"));
registerParser("typescript", (path, content) => parseCodeFile(path, content, "typescript"));
registerParser("css", parseStyleFile);
registerParser("scss", parseStyleFile);
registerParser("less", parseStyleFile);
registerParser("stylus", parseStyleFile);
registerParser("coffeescript", parseCoffeeScript);
registerParser("livescript", parseLiveScript);
registerParser("lua", parseLua);
registerParser("gherkin", parseGherkin);

export {
  getBarrelThreshold,
  getTestLibraries,
  getTestPatterns,
  registerConfigMatcher,
  registerTestLibrary,
  registerTestPattern,
  setBarrelThreshold,
} from "./parser/classify.js";
export { getFileType } from "./parser/file-type.js";
export { registerParser } from "./parser/registry.js";

/**
 * Main entry point for parsing a file.
 * Dispatches to specific parsers based on file type.
 */
export async function parseFile(filePath: string, content: string): Promise<ParseResult> {
  const fileType = getFileType(filePath);
  const parser = getParserForType(fileType);

  if (parser) {
    return await parser(filePath, content);
  }

  return { imports: [], exports: [], tags: [], category: "other" };
}

export async function parseImports(filePath: string, content: string): Promise<ImportEdge[]> {
  const result = await parseFile(filePath, content);
  return result.imports;
}
