/**
 * `CachedCoverageResult` — the merged `relPath → lineCoveragePct` map from the last on-demand
 * coverage run — and its disk persistence. Mirrors
 * `src/graph/duplication/result-cache-store.ts`: sync JSON I/O, `mkdir -p` on save, never-throws
 * on read (any missing/corrupt/stale/wrong-shaped file degrades to a cache miss, i.e. "run
 * coverage again"). One file for the whole repo/workspace (`DEFAULT_COVERAGE_RESULT_CACHE_FILE`),
 * not per-package — running every package's test suite already happens together, so there's no
 * separate-invalidation benefit to per-package files the way there is for the duplication scan.
 *
 * The digest covers every graph node's path/mtime/size ({@link digestNodes}, shared with the
 * duplication result cache) so any add/remove/edit invalidates it; a separate params key covers
 * the coverage-affecting config knobs (`timeoutMs`, `packages`) so changing them invalidates too.
 * There is deliberately no partial re-run: one changed file can only be resolved by re-running
 * the whole test suite honestly, so the granularity is "recompute everything on any change" —
 * same call the duplication result cache and workspace graph cache make.
 */
import fs from "node:fs";
import path from "node:path";
import { ensureCacheDir } from "../../cache-dir";

export interface CoverageResultParams {
  timeoutMs: number;
  packages: string[] | undefined;
}

export interface CachedCoverageResult {
  /** Digest of the graph nodes this result was computed against. */
  digest: string;
  /** {@link coverageResultCacheKey} of the run params at write time. */
  paramsKey: string;
  /** `relPath → lineCoveragePct` entries, serialized as an array since `Map` isn't JSON-native. */
  entries: [string, number][];
}

/**
 * @description Stable string form of the coverage-affecting run params, for the cache key.
 * @param {CoverageResultParams} params - The run knobs.
 * @returns {string} A canonical JSON string to compare byte-for-byte.
 */
export function coverageResultCacheKey(params: CoverageResultParams): string {
  return JSON.stringify({
    timeoutMs: params.timeoutMs,
    packages: params.packages ? [...params.packages].sort() : null,
  });
}

function isCachedCoverageResult(value: unknown): value is CachedCoverageResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedCoverageResult>;
  return (
    typeof candidate.digest === "string" &&
    typeof candidate.paramsKey === "string" &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(
      (e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && typeof e[1] === "number",
    )
  );
}

/**
 * @description Reads a `CachedCoverageResult` written by {@link saveCoverageResult} and returns
 *   its map only when the stored `digest` and `paramsKey` both still match. Any other outcome
 *   (missing file, corrupt JSON, wrong shape, stale digest, different params) returns `null`,
 *   which the caller treats as "run coverage again". Never throws.
 * @param {string} cachePath - Path to the JSON file written by `saveCoverageResult`.
 * @param {string} digest - The current node digest to validate against.
 * @param {string} paramsKey - The current {@link coverageResultCacheKey} to validate against.
 * @returns {Map<string, number> | null} The cached coverage map, or `null` on any miss.
 */
export function loadCoverageResult(
  cachePath: string,
  digest: string,
  paramsKey: string,
): Map<string, number> | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (!isCachedCoverageResult(parsed)) return null;
    if (parsed.digest !== digest || parsed.paramsKey !== paramsKey) return null;
    return new Map(parsed.entries);
  } catch {
    return null;
  }
}

/**
 * @description Serializes the merged coverage map to `cachePath` (creating parent dirs), stamped
 *   with the `digest`/`paramsKey` it is valid for. A write failure is logged to stderr and
 *   otherwise swallowed — the result cache is pure acceleration and must never fail the run that
 *   produced it.
 * @param {string} cachePath - Destination path; parent directories are created automatically.
 * @param {string} digest - The node digest this result was computed against.
 * @param {string} paramsKey - The {@link coverageResultCacheKey} this result was computed against.
 * @param {Map<string, number>} coverageMap - The merged coverage map to persist.
 * @returns {void}
 */
export function saveCoverageResult(
  cachePath: string,
  digest: string,
  paramsKey: string,
  coverageMap: Map<string, number>,
): void {
  try {
    const dir = path.dirname(cachePath);
    ensureCacheDir(dir);
    const payload: CachedCoverageResult = {
      digest,
      paramsKey,
      entries: [...coverageMap.entries()],
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload));
  } catch (err) {
    process.stderr.write(`Warning: failed to persist coverage result cache: ${err}\n`);
  }
}
