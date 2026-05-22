import fs from "node:fs";
import path from "node:path";

interface CoverageSummaryEntry {
  lines?: { pct?: number };
  [key: string]: unknown;
}

/**
 * @description Reads an Istanbul/v8 `coverage-summary.json` file and returns a map of
 *   project-relative file paths to their line-coverage percentage (0–100).
 *   Returns an empty map when the file is missing, unreadable, or malformed — the
 *   caller can always proceed safely with no coverage data.
 * @param rootDir - Absolute path to the project root; used to make paths relative.
 * @param reportPath - Path to the coverage summary JSON, relative to `rootDir`.
 * @returns A map of `relativePath → lineCoveragePct`.
 */
export function loadCoverageMap(rootDir: string, reportPath: string): Map<string, number> {
  const absoluteReport = path.resolve(rootDir, reportPath);
  try {
    const raw = fs.readFileSync(absoluteReport, "utf-8");
    const summary = JSON.parse(raw) as Record<string, CoverageSummaryEntry>;
    const map = new Map<string, number>();
    for (const [absPath, entry] of Object.entries(summary)) {
      if (absPath === "total") continue;
      const pct = entry?.lines?.pct;
      if (typeof pct !== "number") continue;
      const relative = path.relative(rootDir, absPath);
      map.set(relative, pct);
    }
    return map;
  } catch {
    return new Map();
  }
}
