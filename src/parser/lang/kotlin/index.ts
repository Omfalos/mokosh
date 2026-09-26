import type { LRParser } from "@lezer/lr";

// generated/parser.js has no types of its own (plain JS, no co-located .d.ts — that directory is
// pure build output, gitignored, and nothing hand-written belongs inside it), so the value is
// require()'d and annotated here instead of using a type-checked `export ... from` re-export.
const { parser } = require("./generated/parser.js") as { parser: LRParser };

/** Parser for `.kts` scripts: same grammar, `Script` top rule (top-level statements) instead of
 *  `Program` (top-level declarations). */
const scriptParser = parser.configure({ top: "Script" });

export { parser, scriptParser };
