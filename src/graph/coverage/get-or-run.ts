/** Top-level entry point for `coverage.mode: "exec"` (real, test-execution-based coverage):
 *  checks the disk result cache against the current graph's node digest, and only runs the
 *  actual test suites on a miss. `coverage.mode: "static"` doesn't go through here at all — see
 *  `static-estimate.ts` instead, which needs no cache since it costs nothing beyond graph
 *  traversal. Called as a post-build enrichment step (see `enrichCoverage`), not fed into
 *  `GraphBuilder` — coverage isn't needed to build the graph, and computing the digest from
 *  already-built nodes avoids a second filesystem walk. */
import path from "node:path";
import { DEFAULT_CACHE_DIR, DEFAULT_COVERAGE_RESULT_CACHE_FILE } from "../../const";
import { digestNodes } from "../node-digest";
import type { MonorepoLayout } from "../workspace/types";
import {
  coverageResultCacheKey,
  loadCoverageResult,
  saveCoverageResult,
} from "./result-cache-store";
import { DEFAULT_COVERAGE_TIMEOUT_MS, runAutoCoverage } from "./run-coverage";

export interface AutoCoverageOptions {
  timeoutMs?: number | undefined;
  packages?: string[] | undefined;
}

/**
 * @description Returns the on-demand coverage map for `rootDir`, reusing the disk cache when the
 *   node digest and run params are unchanged, otherwise running every detected coverage runner
 *   and persisting the result before returning.
 * @param rootDir - Absolute project/monorepo root; `mokosh-cache/coverage-result.json` lives
 *   directly under it (or a custom `cachePath`, see `cacheDir`).
 * @param nodes - The already-built graph's nodes (single `Graph`, or a monorepo's flattened
 *   node set) — only their `path`/`mtime`/`size` are read, to compute the cache digest.
 * @param layout - A `detectMonorepo` result, or `undefined` for a single-language repo.
 * @param options - `timeoutMs`/`packages`, see `MokoshConfig.coverage`.
 * @param cacheDir - Override for the cache directory (default: `<rootDir>/mokosh-cache`).
 * @returns The merged `relPath → lineCoveragePct` map — from cache, or freshly computed.
 */
export async function getOrRunCoverage(
  rootDir: string,
  nodes: Iterable<{ path: string; mtime: number; size: number }>,
  layout: MonorepoLayout | undefined,
  options: AutoCoverageOptions = {},
  cacheDir: string = path.join(rootDir, DEFAULT_CACHE_DIR),
): Promise<Map<string, number>> {
  const digest = digestNodes(nodes);
  const timeoutMs = options.timeoutMs ?? DEFAULT_COVERAGE_TIMEOUT_MS;
  const paramsKey = coverageResultCacheKey({ timeoutMs, packages: options.packages });
  const cachePath = path.join(cacheDir, DEFAULT_COVERAGE_RESULT_CACHE_FILE);

  const cached = loadCoverageResult(cachePath, digest, paramsKey);
  if (cached) return cached;

  const coverageMap = await runAutoCoverage(rootDir, layout, options);
  saveCoverageResult(cachePath, digest, paramsKey, coverageMap);
  return coverageMap;
}
