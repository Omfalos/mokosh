/** Orchestrates on-demand coverage: for every scan root, runs every matching language runner in
 *  parallel and merges the results into one project-root-relative map. Never throws — a failing
 *  runner just contributes nothing, logged to stderr, exactly like a missing/malformed
 *  `coverageReportPath` file degrades to an empty map today. */
import type { MonorepoLayout } from "../workspace/types";
import { COVERAGE_RUNNERS } from "./runners/index";
import { resolveCoverageScanRoots } from "./scan-roots";
import type { CoverageRunOptions } from "./types";

export const DEFAULT_COVERAGE_TIMEOUT_MS = 5 * 60 * 1000;

export interface RunAutoCoverageOptions {
  timeoutMs?: number | undefined;
  packages?: string[] | undefined;
}

/**
 * @description Runs every detected coverage runner across every scan root (one per monorepo
 *   package, or just the project root for a single-language repo) in parallel, and merges each
 *   runner's directory-relative map into one project-root-relative map. Multiple runners
 *   matching the same root (a polyglot package) all run; a path reported by more than one runner
 *   keeps whichever result lands last — collisions are not expected in practice.
 * @param rootDir - Absolute project/monorepo root.
 * @param layout - A `detectMonorepo` result, or `undefined` for a single-language repo.
 * @param options - `timeoutMs` per runner (default {@link DEFAULT_COVERAGE_TIMEOUT_MS});
 *   `packages` narrows which monorepo packages are scanned.
 * @returns Map of project-relative path (forward-slash separated) → line-coverage percentage.
 *   Empty when nothing was detected or every runner failed/timed out.
 */
export async function runAutoCoverage(
  rootDir: string,
  layout: MonorepoLayout | undefined,
  options: RunAutoCoverageOptions = {},
): Promise<Map<string, number>> {
  const runOpts: CoverageRunOptions = {
    timeoutMs: options.timeoutMs ?? DEFAULT_COVERAGE_TIMEOUT_MS,
  };
  const scanRoots = resolveCoverageScanRoots(rootDir, layout, options.packages);

  const jobs = scanRoots.flatMap((root) =>
    COVERAGE_RUNNERS.filter((runner) => runner.detect(root.dir)).map(async (runner) => {
      try {
        const map = await runner.run(root.dir, runOpts);
        return { root, runner, map };
      } catch (err) {
        process.stderr.write(
          `Warning: coverage runner "${runner.name}" failed for ${root.dir}: ${err}\n`,
        );
        return { root, runner, map: null };
      }
    }),
  );

  const settled = await Promise.all(jobs);
  const merged = new Map<string, number>();
  for (const { root, map } of settled) {
    if (!map) continue;
    for (const [relPath, pct] of map) merged.set(`${root.relPrefix}${relPath}`, pct);
  }
  return merged;
}
