/** Parser registry: maps FileType values to parser functions and provides lookup by file type. */
import type { FileType } from "../types/parse";
import type { ParseResult } from "./types";

export type ParserFunction = (
  filePath: string,
  content: string,
) => ParseResult | Promise<ParseResult>;

const parserRegistry = new Map<FileType, ParserFunction>();

/**
 * @description Registers a parser function for a given file type, overwriting any
 *   previously registered parser for that type.
 * @param type - The `FileType` key this parser should handle.
 * @param parser - The parsing function that extracts imports and tags from file content.
 */
export function registerParser(type: FileType, parser: ParserFunction) {
  parserRegistry.set(type, parser);
}

/**
 * @description Looks up the registered parser for the given file type.
 * @param type - The `FileType` to look up.
 * @returns The registered `ParserFunction`, or `undefined` if none has been registered for this type.
 */
export function getParserForType(type: FileType): ParserFunction | undefined {
  return parserRegistry.get(type);
}
