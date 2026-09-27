/** On-demand coverage runner for Python projects via `pytest` + `coverage.py`'s JSON report
 *  (`coverage json`), which is what `pytest --cov --cov-report=json` writes. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../exec-util";
import type { CoverageRunner, CoverageRunOptions } from "../types";

const PYTHON_MARKERS = ["pytest.ini", "pyproject.toml", "setup.cfg", "conftest.py", "tox.ini"];

interface CoverageJsonReport {
  files?: Record<string, { summary?: { percent_covered?: number } }>;
}

export const pythonCoverageRunner: CoverageRunner = {
  name: "python",

  detect(dir: string): boolean {
    return PYTHON_MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
  },

  async run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null> {
    const reportFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-coverage-py-")),
      "coverage.json",
    );
    try {
      const result = await runCommand(
        "python3",
        ["-m", "pytest", "--cov=.", `--cov-report=json:${reportFile}`, "-q"],
        dir,
        opts.timeoutMs,
      );
      if (result.timedOut) return null;
      if (!fs.existsSync(reportFile)) return null;

      const raw: unknown = JSON.parse(fs.readFileSync(reportFile, "utf-8"));
      const map = new Map<string, number>();
      const files = (raw as CoverageJsonReport)?.files;
      if (!files || typeof files !== "object") return null;
      for (const [absOrRelPath, entry] of Object.entries(files)) {
        const pct = entry?.summary?.percent_covered;
        if (typeof pct !== "number") continue;
        const relative = path.isAbsolute(absOrRelPath)
          ? path.relative(dir, absOrRelPath)
          : absOrRelPath;
        map.set(relative.split(path.sep).join("/"), pct);
      }
      return map.size > 0 ? map : null;
    } catch {
      return null;
    } finally {
      fs.rmSync(path.dirname(reportFile), { recursive: true, force: true });
    }
  },
};
