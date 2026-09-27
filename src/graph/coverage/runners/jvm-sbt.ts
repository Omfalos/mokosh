/** On-demand coverage runner for sbt JVM (Scala) projects via the sbt-scoverage plugin's
 *  `scoverage.xml` (a flat `<statements><statement>...</statement>...</statements>` list, unlike
 *  JaCoCo's nested attribute-based report — see `parseScoverageReport`). Requires the project to
 *  already have `sbt-scoverage` added as a plugin; when it doesn't, `sbt coverage` fails and no
 *  report is produced, treated as "contributed nothing" like every other runner. */
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "../exec-util";
import type { CoverageRunner, CoverageRunOptions } from "../types";

const STATEMENT_BLOCK_RE = /<statement>([\s\S]*?)<\/statement>/g;

function innerText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(block);
  return match?.[1] ?? null;
}

interface LineKey {
  file: string;
  line: number;
}

/**
 * @description Parses an sbt-scoverage `scoverage.xml` into per-file line-coverage percentages.
 *   A line counts as covered if any non-ignored statement on that line has `count > 0`;
 *   percentage is `coveredLines / totalLines` per file — the same line-level granularity
 *   `coverage.py`/Istanbul report, even though scoverage's own raw unit is the statement.
 * @param xml - Raw `scoverage.xml` report text.
 * @param projectDir - Absolute sbt project root, used to relativize each statement's `<source>`.
 * @returns Map of project-relative path (forward-slash separated) → line-coverage percentage.
 */
export function parseScoverageReport(xml: string, projectDir: string): Map<string, number> {
  const lineCovered = new Map<string, boolean>();
  const keyOf = (k: LineKey): string => `${k.file}\0${k.line}`;

  for (const match of xml.matchAll(STATEMENT_BLOCK_RE)) {
    const block = match[1];
    if (block === undefined) continue;
    if (innerText(block, "ignored") === "true") continue;

    const source = innerText(block, "source");
    const lineStr = innerText(block, "line");
    const countStr = innerText(block, "count");
    if (!source || !lineStr || !countStr) continue;
    const line = Number(lineStr);
    const count = Number(countStr);
    if (!Number.isFinite(line) || !Number.isFinite(count)) continue;

    const relFile = (path.isAbsolute(source) ? path.relative(projectDir, source) : source)
      .split(path.sep)
      .join("/");
    const key = keyOf({ file: relFile, line });
    lineCovered.set(key, (lineCovered.get(key) ?? false) || count > 0);
  }

  const totals = new Map<string, { covered: number; total: number }>();
  for (const [key, covered] of lineCovered) {
    const file = key.split("\0")[0];
    if (!file) continue;
    const entry = totals.get(file) ?? { covered: 0, total: 0 };
    entry.total += 1;
    if (covered) entry.covered += 1;
    totals.set(file, entry);
  }

  const result = new Map<string, number>();
  for (const [file, { covered, total }] of totals) {
    if (total > 0) result.set(file, (covered / total) * 100);
  }
  return result;
}

function findScoverageReport(dir: string): string | null {
  const targetDir = path.join(dir, "target");
  if (!fs.existsSync(targetDir)) return null;
  for (const entry of fs.readdirSync(targetDir)) {
    if (!entry.startsWith("scala-")) continue;
    const candidate = path.join(targetDir, entry, "scoverage-report", "scoverage.xml");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export const sbtCoverageRunner: CoverageRunner = {
  name: "sbt",

  detect(dir: string): boolean {
    return fs.existsSync(path.join(dir, "build.sbt"));
  },

  async run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null> {
    try {
      const result = await runCommand(
        "sbt",
        ["coverage", "test", "coverageReport"],
        dir,
        opts.timeoutMs,
      );
      if (result.timedOut) return null;

      const xmlPath = findScoverageReport(dir);
      if (!xmlPath) return null;
      const map = parseScoverageReport(fs.readFileSync(xmlPath, "utf-8"), dir);
      return map.size > 0 ? map : null;
    } catch {
      return null;
    }
  },
};
