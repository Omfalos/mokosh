/** On-demand coverage runner for JS/TS projects via Vitest or Jest, producing an Istanbul
 *  `coverage-summary.json` that's read with the same `loadCoverageMap` the `coverageReportPath`
 *  option already uses. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCoverageMap } from "../../../coverage";
import { runCommand } from "../exec-util";
import type { CoverageRunner, CoverageRunOptions } from "../types";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")) as PackageJson;
  } catch {
    return null;
  }
}

function hasDep(pkg: PackageJson | null, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}

function hasConfigFile(dir: string, base: string): boolean {
  return [".js", ".mjs", ".cjs", ".ts", ".mts"].some((ext) =>
    fs.existsSync(path.join(dir, `${base}${ext}`)),
  );
}

function detectRunner(dir: string): "vitest" | "jest" | null {
  const pkg = readPackageJson(dir);
  if (!pkg) return null;
  if (hasDep(pkg, "vitest") || hasConfigFile(dir, "vitest.config")) return "vitest";
  if (hasDep(pkg, "jest") || hasConfigFile(dir, "jest.config")) return "jest";
  return null;
}

export const jsCoverageRunner: CoverageRunner = {
  name: "js",

  detect(dir: string): boolean {
    return detectRunner(dir) !== null;
  },

  async run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null> {
    const runner = detectRunner(dir);
    if (!runner) return null;

    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mokosh-coverage-js-"));
    try {
      const [cmd, args] =
        runner === "vitest"
          ? [
              "npx",
              [
                "--yes",
                "vitest",
                "run",
                "--coverage",
                "--coverage.reporter=json-summary",
                `--coverage.reportsDirectory=${reportsDir}`,
              ],
            ]
          : [
              "npx",
              [
                "--yes",
                "jest",
                "--coverage",
                "--coverageReporters=json-summary",
                `--coverageDirectory=${reportsDir}`,
              ],
            ];

      const result = await runCommand(cmd, args, dir, opts.timeoutMs);
      if (result.timedOut) return null;

      const summaryPath = path.join(reportsDir, "coverage-summary.json");
      if (!fs.existsSync(summaryPath)) return null;
      const map = loadCoverageMap(dir, summaryPath);
      return map.size > 0 ? map : null;
    } catch {
      return null;
    } finally {
      fs.rmSync(reportsDir, { recursive: true, force: true });
    }
  },
};
