// Phase 1 go/no-go gate for the Kotlin Lezer grammar (see
// src/parser/lang/kotlin/PROGRESS.md and the "Kotlin support" plan). Parses every .kt file in a
// given real-world corpus directory and reports the error-node-span ratio (error span chars /
// total source chars) and wall-clock time. This is the empirical basis for the error-density
// threshold used later by complexity/call-edge extraction's per-file skip gate (Phase 2) and the
// actual decision point for whether the hybrid-integration work (Phase 1) proceeds at all.
//
// usage: node scripts/kotlin-corpus-gate.mjs <corpus-dir> [--top N]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { parser } = require("../src/parser/lang/kotlin/generated/parser.js");

const args = process.argv.slice(2);
const topIdx = args.indexOf("--top");
const topN = topIdx === -1 ? 15 : Number(args[topIdx + 1]);
const positional = topIdx === -1 ? args : args.filter((_, i) => i !== topIdx && i !== topIdx + 1);
const corpusDir = positional[0];

if (!corpusDir) {
  console.error("usage: node scripts/kotlin-corpus-gate.mjs <corpus-dir> [--top N]");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "build" || entry === "out")
      continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith(".kt")) out.push(full);
  }
  return out;
}

const files = walk(path.resolve(corpusDir));
if (files.length === 0) {
  console.error(`no .kt files found under ${corpusDir}`);
  process.exit(1);
}

const results = [];
let totalChars = 0;
let totalErrorChars = 0;
let parseErrors = 0;

const start = process.hrtime.bigint();

for (const file of files) {
  const source = readFileSync(file, "utf8");
  totalChars += source.length;
  try {
    const tree = parser.parse(source);
    let errorChars = 0;
    tree.iterate({
      enter(node) {
        if (node.type.isError) errorChars += node.to - node.from;
      },
    });
    totalErrorChars += errorChars;
    results.push({
      file,
      size: source.length,
      errorChars,
      ratio: source.length > 0 ? errorChars / source.length : 0,
    });
  } catch (err) {
    parseErrors++;
    results.push({
      file,
      size: source.length,
      errorChars: source.length,
      ratio: 1,
      threw: String(err),
    });
  }
}

const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

results.sort((a, b) => b.ratio - a.ratio);

console.log(`corpus: ${corpusDir}`);
console.log(`files parsed: ${files.length}`);
console.log(`parse exceptions (hard failures, not just error nodes): ${parseErrors}`);
console.log(`total source chars: ${totalChars}`);
console.log(`total error-node-span chars: ${totalErrorChars}`);
console.log(`overall error-span ratio: ${(totalErrorChars / totalChars).toFixed(5)}`);
console.log(
  `wall-clock: ${elapsedMs.toFixed(1)}ms (${(elapsedMs / files.length).toFixed(3)}ms/file avg)`,
);
console.log("");
console.log(`worst ${topN} files by error-span ratio:`);
for (const r of results.slice(0, topN)) {
  if (r.ratio === 0) break;
  const rel = path.relative(process.cwd(), r.file);
  const tag = r.threw ? " [THREW]" : "";
  console.log(`  ${(r.ratio * 100).toFixed(2)}%  (${r.errorChars}/${r.size} chars)  ${rel}${tag}`);
}

const cleanFiles = results.filter((r) => r.ratio === 0).length;
console.log("");
console.log(
  `clean-parse files (0 error chars): ${cleanFiles}/${files.length} (${((cleanFiles / files.length) * 100).toFixed(1)}%)`,
);
