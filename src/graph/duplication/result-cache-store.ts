/**
 * `CachedDuplicationResult` — the full `{ groups, clusters }` from a `findDuplicates` scan — and
 * its disk persistence, mirroring `token-cache-store.ts`'s shape (sync JSON I/O, `mkdir -p` on
 * save, never-throws on read: any missing / corrupt / stale / wrong-shaped file degrades to a
 * cache miss, i.e. today's "just run the scan" behaviour).
 *
 * Where the token cache only saves re-*tokenizing* unchanged files, this saves the whole
 * analysis — suffix-array build, exact matching, dominance filter, clustering — behind a single
 * digest check. The digest covers every in-scope file's path + mtime + size (so any add /
 * remove / edit invalidates it); a separate params key covers the output-affecting scan knobs
 * (so flipping `scope`, `minLines`, `includeGenerated`, … invalidates it). There is deliberately
 * no partial / incremental reuse: one changed file can create or destroy a match anywhere in the
 * token stream, so the honest granularity is "recompute everything on any change" — the same
 * call the workspace graph cache makes.
 *
 * `filter` / `view` / `limit` / `slim` are NOT part of the key: they shape the *response* from
 * an already-computed full result, so one cached result serves every variation of them.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DuplicateCluster } from "./clusters";
import type { DuplicateGroup } from "./shingle";

/** The output-affecting `findDuplicates` knobs — everything that changes which groups/clusters
 *  the scan produces. Folded into the cache key via {@link duplicationResultCacheKey}; a
 *  mismatch is a cache miss. `filter` is deliberately absent — the cache only ever holds an
 *  unfiltered scan. Any new output-affecting option wired into `findDuplicates` (e.g. a future
 *  `minScore`) must be added here too, or a run that changes it will read a stale result. */
export interface DuplicationResultParams {
  minLines: number;
  ignoreLiterals: boolean;
  maxPunctuationRatio: number;
  /** The per-scan cap passed to `findDuplicates` — the stored result holds at most this many
   *  groups per package, so a later run wanting more must re-scan. */
  limit: number;
  scope: string | undefined;
  includeGenerated: boolean;
  includeSameFile: boolean;
  includeSvgMarkup: boolean;
  includeDocs: boolean;
  ignoreDirs: string[];
  ignoreGlobs: string[];
}

export interface CachedDuplicationResult {
  /** {@link duplicationDigest} of the in-scope files at write time. */
  digest: string;
  /** {@link duplicationResultCacheKey} of the scan params at write time. */
  paramsKey: string;
  groups: DuplicateGroup[];
  clusters: DuplicateCluster[];
}

/**
 * @description One `path\0mtime\0size` line per node, sha256'd over the sorted set — the same
 *   unit `computeWorkspaceSourceDigest` (`src/index.ts`) hashes, but sourced from the in-memory
 *   graph (every `FileNode` already carries `mtime`/`size`) so no `fs.stat` walk is needed.
 *   Passing the whole node set (a superset of what `findDuplicates` actually scans) is
 *   intentional: an out-of-scope change over-invalidates, which is safe.
 * @param {Iterable<{ path: string; mtime: number; size: number }>} nodes - Graph file nodes.
 * @returns {string} Hex sha-256 digest.
 */
export function duplicationDigest(
  nodes: Iterable<{ path: string; mtime: number; size: number }>,
): string {
  const lines: string[] = [];
  for (const node of nodes) lines.push(`${node.path}\0${node.mtime}\0${node.size}`);
  lines.sort();
  const hash = crypto.createHash("sha256");
  for (const line of lines) hash.update(`${line}\n`);
  return hash.digest("hex");
}

/**
 * @description Stable string form of the scan params for the cache key — keys emitted in a fixed
 *   order, arrays sorted — so equivalent params always produce the same string regardless of how
 *   the caller assembled them.
 * @param {DuplicationResultParams} params - The output-affecting scan knobs.
 * @returns {string} A canonical JSON string to compare byte-for-byte.
 */
export function duplicationResultCacheKey(params: DuplicationResultParams): string {
  return JSON.stringify({
    minLines: params.minLines,
    ignoreLiterals: params.ignoreLiterals,
    maxPunctuationRatio: params.maxPunctuationRatio,
    limit: params.limit,
    scope: params.scope ?? null,
    includeGenerated: params.includeGenerated,
    includeSameFile: params.includeSameFile,
    includeSvgMarkup: params.includeSvgMarkup,
    includeDocs: params.includeDocs,
    ignoreDirs: [...params.ignoreDirs].sort(),
    ignoreGlobs: [...params.ignoreGlobs].sort(),
  });
}

function isCachedDuplicationResult(value: unknown): value is CachedDuplicationResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedDuplicationResult>;
  return (
    typeof candidate.digest === "string" &&
    typeof candidate.paramsKey === "string" &&
    Array.isArray(candidate.groups) &&
    Array.isArray(candidate.clusters)
  );
}

/**
 * @description Reads a `CachedDuplicationResult` written by {@link saveDuplicationResult} and
 *   returns its `{ groups, clusters }` only when the stored `digest` and `paramsKey` both still
 *   match — i.e. no in-scope file changed and the scan params are identical. Any other outcome
 *   (missing file, corrupt JSON, wrong shape, stale digest, different params) returns `null`,
 *   which the caller treats as "run the scan". Never throws.
 * @param {string} cachePath - Path to the JSON file written by `saveDuplicationResult`.
 * @param {string} digest - The current {@link duplicationDigest} to validate against.
 * @param {string} paramsKey - The current {@link duplicationResultCacheKey} to validate against.
 * @returns {{ groups: DuplicateGroup[]; clusters: DuplicateCluster[] } | null} The cached result,
 *   or `null` on any miss.
 */
export function loadDuplicationResult(
  cachePath: string,
  digest: string,
  paramsKey: string,
): { groups: DuplicateGroup[]; clusters: DuplicateCluster[] } | null {
  try {
    if (!fs.existsSync(cachePath)) return null;
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
    if (!isCachedDuplicationResult(parsed)) return null;
    if (parsed.digest !== digest || parsed.paramsKey !== paramsKey) return null;
    return { groups: parsed.groups, clusters: parsed.clusters };
  } catch {
    return null;
  }
}

/**
 * @description Serializes the full scan result to `cachePath` (creating parent dirs), stamped
 *   with the `digest` / `paramsKey` it is valid for. A write failure is logged to stderr and
 *   otherwise swallowed — the result cache is pure acceleration and must never fail the call
 *   that produced it.
 * @param {string} cachePath - Destination path; parent directories are created automatically.
 * @param {string} digest - The {@link duplicationDigest} this result was computed against.
 * @param {string} paramsKey - The {@link duplicationResultCacheKey} this result was computed
 *   against.
 * @param {readonly DuplicateGroup[]} groups - The full pre-`limit` group list from the scan.
 * @param {readonly DuplicateCluster[]} clusters - The full cluster list from the scan.
 * @returns {void}
 */
export function saveDuplicationResult(
  cachePath: string,
  digest: string,
  paramsKey: string,
  groups: readonly DuplicateGroup[],
  clusters: readonly DuplicateCluster[],
): void {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload: CachedDuplicationResult = {
      digest,
      paramsKey,
      groups: [...groups],
      clusters: [...clusters],
    };
    fs.writeFileSync(cachePath, JSON.stringify(payload));
  } catch (err) {
    process.stderr.write(`Warning: failed to persist duplication result cache: ${err}\n`);
  }
}
