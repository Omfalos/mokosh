/** Aggregates all language parsers and exposes parseFile and parseImports as the unified entry points. */
import { getFileType } from "./parser/file-type";
import { parseCoffeeScript } from "./parser/lang/coffee";
import { parseGherkin } from "./parser/lang/gherkin";
import { parseGo } from "./parser/lang/go";
import { parseLiveScript } from "./parser/lang/ls";
import { parseLua } from "./parser/lang/lua";
import { parseMarkdown } from "./parser/lang/markdown";
import { parsePython } from "./parser/lang/python";
import { parseCodeFile } from "./parser/lang/typescript";
import type { ParserFunction } from "./parser/registry";
import { getParserForType, registerParser } from "./parser/registry";
import { parseStyleFile } from "./parser/style";
import type { ParseResult } from "./parser/types";
import type { ImportEdge } from "./types/node";
import type { FileType } from "./types/parse";

for (const [type, parser] of [
  ["javascript", (path, content) => parseCodeFile(path, content, "javascript")],
  ["typescript", (path, content) => parseCodeFile(path, content, "typescript")],
  ["css", parseStyleFile],
  ["scss", parseStyleFile],
  ["less", parseStyleFile],
  ["stylus", parseStyleFile],
  ["coffeescript", parseCoffeeScript],
  ["livescript", parseLiveScript],
  ["lua", parseLua],
  ["python", parsePython],
  ["go", parseGo],
  ["gherkin", parseGherkin],
  ["markdown", parseMarkdown],
] satisfies [FileType, ParserFunction][]) {
  registerParser(type, parser);
}

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
 * @description Main entry point for parsing a file. Dispatches to a registered
 *   language-specific parser based on the file's extension, falling back to an
 *   empty result for unknown types.
 * @param {string} filePath - Absolute or relative path to the file; determines which parser is used.
 * @param {string} content - Raw source content of the file.
 * @returns {Promise<ParseResult>} Parsed imports, exports, tags, and category for the file.
 */
export async function parseFile(filePath: string, content: string): Promise<ParseResult> {
  const fileType = getFileType(filePath);
  const parser = getParserForType(fileType);

  if (parser) {
    return parser(filePath, content);
  }

  return { imports: [], exports: [], tags: [], category: "other" };
}

/**
 * @description Parses a file and returns only its import edges, discarding exports, tags, and category.
 * @param {string} filePath - Path to the file being parsed; determines the parser to use.
 * @param {string} content - Raw source content of the file.
 * @returns {Promise<ImportEdge[]>} All import edges extracted from the file.
 */
export async function parseImports(filePath: string, content: string): Promise<ImportEdge[]> {
  const result = await parseFile(filePath, content);
  return result.imports;
}
