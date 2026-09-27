/** On-demand coverage runner for Go modules via `go test -coverprofile`, parsing the raw
 *  coverprofile format directly (no dependency on `go tool cover`'s text output). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../exec-util";
import type { CoverageRunner, CoverageRunOptions } from "../types";

function readModulePath(dir: string): string | null {
  try {
    const content = fs.readFileSync(path.join(dir, "go.mod"), "utf-8");
    const match = content.match(/^module\s+(\S+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** One coverprofile data line: `<file>:<startLine>.<startCol>,<endLine>.<endCol> <numStmts> <count>`. */
const PROFILE_LINE_RE = /^(\S+):\d+\.\d+,\d+\.\d+ (\d+) (\d+)$/;

/**
 * @description Parses a `go test -coverprofile` file into per-file line-coverage percentages.
 *   Aggregates per-file statement counts (each covered block contributes its statement count to
 *   either the covered or total bucket) rather than reporting per-block granularity.
 * @param raw - Raw coverprofile text (starts with a `mode: ...` header line).
 * @param modulePath - The Go module path from `go.mod`, stripped from each entry's file prefix
 *   to recover a path relative to the module root.
 * @returns Map of module-relative path (forward-slash separated) → line-coverage percentage.
 */
export function parseGoCoverProfile(raw: string, modulePath: string): Map<string, number> {
  const totals = new Map<string, { covered: number; total: number }>();
  for (const line of raw.split("\n")) {
    const match = PROFILE_LINE_RE.exec(line.trim());
    if (!match) continue;
    const [, file, numStmtsStr, countStr] = match;
    if (!file || !numStmtsStr || !countStr) continue;
    const numStmts = Number(numStmtsStr);
    const covered = Number(countStr) > 0 ? numStmts : 0;

    let relFile = file;
    if (relFile === modulePath) continue; // no filename left after stripping — malformed entry
    const prefix = `${modulePath}/`;
    if (relFile.startsWith(prefix)) relFile = relFile.slice(prefix.length);

    const entry = totals.get(relFile) ?? { covered: 0, total: 0 };
    entry.covered += covered;
    entry.total += numStmts;
    totals.set(relFile, entry);
  }

  const result = new Map<string, number>();
  for (const [relFile, { covered, total }] of totals) {
    if (total > 0) result.set(relFile, (covered / total) * 100);
  }
  return result;
}

export const goCoverageRunner: CoverageRunner = {
  name: "go",

  detect(dir: string): boolean {
    return fs.existsSync(path.join(dir, "go.mod"));
  },

  async run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null> {
    const modulePath = readModulePath(dir);
    if (!modulePath) return null;

    const profileFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-coverage-go-")),
      "cover.out",
    );
    try {
      const result = await runCommand(
        "go",
        ["test", "./...", `-coverprofile=${profileFile}`],
        dir,
        opts.timeoutMs,
      );
      if (result.timedOut) return null;
      if (!fs.existsSync(profileFile)) return null;

      const map = parseGoCoverProfile(fs.readFileSync(profileFile, "utf-8"), modulePath);
      return map.size > 0 ? map : null;
    } catch {
      return null;
    } finally {
      fs.rmSync(path.dirname(profileFile), { recursive: true, force: true });
    }
  },
};
