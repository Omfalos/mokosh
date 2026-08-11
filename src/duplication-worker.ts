/** Piscina task handler: tokenizes a single file's content in a worker thread, for `findDuplicates`. */

import type { NormalizedToken } from "./graph/duplication/tokenizer.js";
import { tokenize } from "./graph/duplication/tokenizer.js";
import type { FileType } from "./types/parse";

export default function tokenizeInWorker(payload: {
  source: string;
  fileType: FileType;
  ignoreLiterals: boolean;
}): NormalizedToken[] {
  return tokenize(payload.source, payload.fileType, payload.ignoreLiterals);
}
