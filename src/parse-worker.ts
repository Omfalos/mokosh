/** Piscina task handler: parses a single file's content in a worker thread. */

import type { ParseResult } from "./parser/types";
import { parseFile } from "./parser.js";

export default function parseInWorker(payload: {
  filePath: string;
  content: string;
}): Promise<ParseResult> {
  return parseFile(payload.filePath, payload.content);
}
