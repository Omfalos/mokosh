import path from "node:path";
import { describe, expect, test } from "vitest";
import { createImportMap, getAllProjectFiles, getLanguageCoverage, LANGUAGE_FIDELITY } from "../../src/";
import type { Graph } from "../../src/graph/model";
import type { FileType } from "../../src/types/parse";

/**
 * Language-parity conformance harness (docs/known_issues/08-cross-language-reliability.md, 8a).
 *
 * `example/full-house/` is one fixture project that carries at least one idiomatic file for every
 * language mokosh parses. This suite builds its real graph and asserts, per language:
 *   1. the `fidelity` row echoed in `analyze`'s `languageCoverage` equals `LANGUAGE_FIDELITY` —
 *      tied to a *built graph*, not just the doc-sync check in
 *      `src/graph/language-support.test.ts`;
 *   2. a normalised extraction summary (counts of nodes that got imports / exports / call edges /
 *      complexity) matches an explicit baseline — so a regression in any one language's parser
 *      shows up here as a number change in review, the way a golden snapshot would, but readable.
 *
 * Re-baseline after an intentional parser change by running with `UPDATE_CONFORMANCE=1` and
 * pasting the printed block over `BASELINE` below.
 */

interface LangSummary {
  files: number;
  withImports: number;
  withResolvedImports: number;
  withExports: number;
  withCallEdges: number;
  withComplexity: number;
}

function summarize(graph: Graph): Record<string, LangSummary> {
  const out: Record<string, LangSummary> = {};
  for (const node of graph.nodes.values()) {
    // Drop this harness's own *.test.ts spec files (the builder's test scan re-adds them
    // regardless of entry points); keep everything else, including test.feature.
    if (/\.test\.ts$/.test(node.path)) continue;
    const s = (out[node.type] ??= {
      files: 0,
      withImports: 0,
      withResolvedImports: 0,
      withExports: 0,
      withCallEdges: 0,
      withComplexity: 0,
    });
    s.files++;
    if (node.imports.length > 0) s.withImports++;
    if (node.imports.some((e) => !e.isExternal)) s.withResolvedImports++;
    if (node.exports.length > 0) s.withExports++;
    if ((node.callEdges?.length ?? 0) > 0) s.withCallEdges++;
    if (node.complexity !== undefined) s.withComplexity++;
  }
  return out;
}

/** Merge per-build summaries into one map (the JVM sources build from a different root). */
function merge(...parts: Record<string, LangSummary>[]): Record<string, LangSummary> {
  const out: Record<string, LangSummary> = {};
  for (const part of parts) {
    for (const [type, s] of Object.entries(part)) {
      const acc = (out[type] ??= {
        files: 0,
        withImports: 0,
        withResolvedImports: 0,
        withExports: 0,
        withCallEdges: 0,
        withComplexity: 0,
      });
      acc.files += s.files;
      acc.withImports += s.withImports;
      acc.withResolvedImports += s.withResolvedImports;
      acc.withExports += s.withExports;
      acc.withCallEdges += s.withCallEdges;
      acc.withComplexity += s.withComplexity;
    }
  }
  return out;
}

const ROOT = __dirname;
const JVM_ROOT = path.join(__dirname, "jvm");

async function buildMain(): Promise<Graph> {
  const entries = getAllProjectFiles(ROOT).filter((f) => !f.startsWith("jvm/"));
  return createImportMap(ROOT, entries, null, { silent: true, parallelParsing: false });
}

async function buildJvm(): Promise<Graph> {
  const entries = getAllProjectFiles(JVM_ROOT);
  return createImportMap(JVM_ROOT, entries, null, { silent: true, parallelParsing: false });
}

// Explicit extraction baseline. Languages present in the fixture only — `unknown` is asserted
// separately, `stylus`/`livescript` etc. included. Regenerate with UPDATE_CONFORMANCE=1.
const BASELINE: Record<string, LangSummary> = {
  typescript: { files: 1, withImports: 0, withResolvedImports: 0, withExports: 1, withCallEdges: 0, withComplexity: 1 },
  javascript: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 2, withCallEdges: 1, withComplexity: 2 },
  python: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 2, withCallEdges: 1, withComplexity: 2 },
  go: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 2, withCallEdges: 1, withComplexity: 2 },
  coffeescript: { files: 1, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
  livescript: { files: 1, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
  lua: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 2, withCallEdges: 0, withComplexity: 0 },
  css: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 0, withCallEdges: 0, withComplexity: 0 },
  scss: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
  less: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
  stylus: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 0, withCallEdges: 0, withComplexity: 0 },
  gherkin: { files: 1, withImports: 0, withResolvedImports: 0, withExports: 0, withCallEdges: 0, withComplexity: 0 },
  markdown: { files: 1, withImports: 1, withResolvedImports: 1, withExports: 0, withCallEdges: 0, withComplexity: 0 },
  java: { files: 2, withImports: 1, withResolvedImports: 1, withExports: 2, withCallEdges: 1, withComplexity: 2 },
  kotlin: { files: 3, withImports: 3, withResolvedImports: 3, withExports: 3, withCallEdges: 1, withComplexity: 0 },
  scala: { files: 1, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
  groovy: { files: 3, withImports: 1, withResolvedImports: 1, withExports: 1, withCallEdges: 0, withComplexity: 0 },
};

describe("language conformance (full-house fixture)", { tags: ["conformance", "example"] }, () => {
  test("every non-unknown FileType has a fixture file in the harness", async () => {
    const summary = merge(summarize(await buildMain()), summarize(await buildJvm()));
    const covered = new Set(Object.keys(summary));
    const missing = (Object.keys(LANGUAGE_FIDELITY) as FileType[]).filter(
      (t) => t !== "unknown" && !covered.has(t),
    );
    expect(missing, `add a fixture for: ${missing.join(", ")}`).toEqual([]);
  });

  test("languageCoverage.fidelity matches LANGUAGE_FIDELITY for every language in a real build", async () => {
    for (const graph of [await buildMain(), await buildJvm()]) {
      for (const entry of getLanguageCoverage(graph)) {
        expect(entry.fidelity, `fidelity drift for ${entry.type}`).toEqual(
          LANGUAGE_FIDELITY[entry.type],
        );
      }
    }
  });

  test("per-language extraction summary matches the baseline", async () => {
    const summary = merge(summarize(await buildMain()), summarize(await buildJvm()));
    delete summary.unknown;

    if (process.env.UPDATE_CONFORMANCE) {
      const rows = Object.entries(summary)
        .map(
          ([t, s]) =>
            `  ${t}: ${JSON.stringify(s).replace(/"/g, "").replace(/:/g, ": ").replace(/,/g, ", ")},`,
        )
        .join("\n");
      process.stdout.write(`const BASELINE: Record<string, LangSummary> = {\n${rows}\n};\n`);
    }

    expect(summary).toEqual(BASELINE);
  });

  test("callEdges are extracted exactly for the languages whose fidelity says so", async () => {
    const summary = merge(summarize(await buildMain()), summarize(await buildJvm()));
    for (const [type, s] of Object.entries(summary)) {
      if (type === "unknown") continue;
      const fidelity = LANGUAGE_FIDELITY[type as FileType].callEdges;
      if (fidelity === "none") {
        expect(s.withCallEdges, `${type} should have no call edges`).toBe(0);
      }
    }
  });
});
