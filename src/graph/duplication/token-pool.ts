import path from "node:path";
import Piscina from "piscina";
import type { ParallelTokenizingOption } from "./types";

/** Below this many candidate files, worker-pool spin-up cost outweighs the parallelism benefit —
 *  tokenize in-process instead. Mirrors `GraphBuilder`'s `DEFAULT_MIN_FILES_FOR_POOL`. */
const DEFAULT_MIN_FILES_FOR_POOL = 20;

/**
 * @description Decides whether to spin up a worker pool for tokenizing this scan's candidate
 *   files, and constructs it if so — same shape as `GraphBuilder`'s `parseFile` pool (see
 *   docs/adr-010-parallel-parsing.md), reused here because tokenizing thousands of files
 *   in-process can itself take long enough to matter on a large repo. Pool construction is
 *   wrapped in try/catch — a spawn failure (e.g. a sandboxed environment without `worker_threads`
 *   permission) falls back to synchronous in-process tokenizing for the whole scan.
 * @param option - `false` always tokenizes in-process; `true`/omitted offloads once
 *   `candidateFileCount` reaches `minFiles` (default 20); an object overrides `minFiles`/
 *   `maxThreads`. A `maxThreads` below 1 is clamped to 1, with a stderr warning (Piscina's
 *   constructor throws synchronously on a non-positive value).
 * @param candidateFileCount - Number of files this scan will tokenize, already known up front
 *   (unlike `GraphBuilder`'s discovery-driven traversal), so no pre-scan walk is needed here.
 */
export function createTokenizingPool(
  option: ParallelTokenizingOption,
  candidateFileCount: number,
): Piscina | null {
  if (option === false) return null;

  const opts = typeof option === "object" ? option : {};
  const minFiles = opts.minFiles ?? DEFAULT_MIN_FILES_FOR_POOL;
  if (candidateFileCount < minFiles) return null;

  if (opts.maxThreads !== undefined && opts.maxThreads < 1) {
    process.stderr.write(
      `\nWarning: parallelTokenizing.maxThreads (${opts.maxThreads}) must be at least 1; using 1.\n`,
    );
  }

  try {
    // duplication/index.ts is bundled into dist/index.js (same tsup entry as builder.ts, which
    // relies on the same fact for parse-worker.js — see docs/adr-010-parallel-parsing.md), so
    // __dirname at runtime resolves to dist/, not dist/graph/duplication/.
    return new Piscina({
      filename: path.join(__dirname, "duplication-worker.js"),
      ...(opts.maxThreads !== undefined ? { maxThreads: Math.max(1, opts.maxThreads) } : {}),
    });
  } catch (err) {
    process.stderr.write(
      `\nWarning: failed to start duplicate-detection worker pool, falling back to synchronous tokenizing: ${err}\n`,
    );
    return null;
  }
}
