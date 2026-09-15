// Throwaway sanity check for the Kotlin Lezer grammar (Phase 0) — not wired into the real
// parser. Parses each given .kt file and reports its error-node count. See
// src/parser/lang/kotlin/PROGRESS.md.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parser } = require("../src/parser/lang/kotlin/generated/parser.js");

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/kotlin-grammar-smoke-test.mjs <file.kt> [more.kt ...]");
  process.exit(1);
}

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const tree = parser.parse(source);
  let errorCount = 0;
  tree.iterate({
    enter(node) {
      if (node.type.isError) errorCount++;
    },
  });
  console.log(`${path.relative(process.cwd(), file)}: ${errorCount} error node(s)`);
}
