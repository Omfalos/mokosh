/** Piscina task handler: parses a single file's content in a worker thread. */

import type { ClassifyConfig } from "./parser/classify";
import type { ParseResult } from "./parser/types";
import { parseFile } from "./parser.js";

/** Workers don't share the main thread's process-wide classify registries, so the user's
 *  classification settings travel in every task payload. */
export default function parseInWorker(payload: {
  filePath: string;
  content: string;
  classifyConfig?: ClassifyConfig;
}): Promise<ParseResult> {
  return parseFile(payload.filePath, payload.content, payload.classifyConfig);
}
