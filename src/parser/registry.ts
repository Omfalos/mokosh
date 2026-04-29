import type { FileType } from "../types";
import type { ParseResult } from "./types";

export type ParserFunction = (
  filePath: string,
  content: string,
) => ParseResult | Promise<ParseResult>;

const parserRegistry = new Map<FileType, ParserFunction>();

export function registerParser(type: FileType, parser: ParserFunction) {
  parserRegistry.set(type, parser);
}

export function getParserForType(type: FileType): ParserFunction | undefined {
  return parserRegistry.get(type);
}
