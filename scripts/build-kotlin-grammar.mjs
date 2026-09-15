#!/usr/bin/env node

// Compiles mokosh's own first-party Kotlin Lezer grammar (src/parser/lang/kotlin/kotlin.grammar)
// into src/parser/lang/kotlin/generated/. See docs/adr-021-kotlin-parsing.md. That directory is a
// gitignored build artifact (unlike the conformance baseline's committed-and-drift-checked
// pattern, UPDATE_CONFORMANCE=1) — chained into `npm run build`/`build:prod`, and run as an
// explicit early CI step since it also has to exist before `typecheck`, which runs before
// `build`.
//
// Usage:
//   node scripts/build-kotlin-grammar.mjs            # regenerate in place
//   node scripts/build-kotlin-grammar.mjs --verify    # regenerate into a temp dir and diff
//                                                      # against what's currently on disk (a
//                                                      # local reproducibility check, not a CI
//                                                      # gate — there's no committed baseline)

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildParserFile } from "@lezer/generator";

const here = dirname(fileURLToPath(import.meta.url));
const kotlinDir = join(here, "..", "src", "parser", "lang", "kotlin");
const grammarPath = join(kotlinDir, "kotlin.grammar");
const tokensPath = join(kotlinDir, "tokens.js");
const generatedDir = join(kotlinDir, "generated");

const verify = process.argv.includes("--verify");

function generate(outDir) {
  mkdirSync(outDir, { recursive: true });
  const source = readFileSync(grammarPath, "utf8");
  const { parser, terms } = buildParserFile(source, {
    fileName: grammarPath,
    moduleStyle: "cjs",
  });
  writeFileSync(join(outDir, "parser.js"), parser);
  writeFileSync(join(outDir, "parser.terms.js"), terms);
  // kotlin.grammar's `@external tokens .../ @context ... from "./tokens.js"` resolves relative
  // to the grammar file at build time (where tokens.js actually lives, a sibling of `generated/`)
  // — buildParserFile copies that import path into the generated output verbatim, so `generated/`
  // needs its own copy of tokens.js alongside parser.js for the "./tokens.js" require to resolve
  // at runtime too.
  copyFileSync(tokensPath, join(outDir, "tokens.js"));
}

if (!verify) {
  generate(generatedDir);
  console.log(`Regenerated ${generatedDir}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), "mokosh-kotlin-grammar-"));
  try {
    generate(tmp);
    execFileSync("diff", ["-u", join(generatedDir, "parser.js"), join(tmp, "parser.js")], {
      stdio: "inherit",
    });
    execFileSync(
      "diff",
      ["-u", join(generatedDir, "parser.terms.js"), join(tmp, "parser.terms.js")],
      { stdio: "inherit" },
    );
    console.log("On-disk generated/ output matches a fresh rebuild of kotlin.grammar.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
