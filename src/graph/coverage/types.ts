/** Shared types for on-demand coverage runners — see `docs/adr-023-on-demand-coverage.md`. */

/** Options a runner's `run()` receives. */
export interface CoverageRunOptions {
  /** Per-runner timeout in ms before the spawned process is killed and this runner contributes
   *  nothing. */
  timeoutMs: number;
}

/**
 * One ecosystem's coverage integration: detect whether `dir` looks like a project of this kind,
 * then run its native test/coverage tool and parse the result into a `dir`-relative path → line
 * coverage % map. `run` never throws — any failure (tool missing, tests failing, malformed
 * output, timeout) is caught by the caller and treated as "this runner contributed nothing",
 * exactly like `loadCoverageMap` degrading to an empty map on a missing/malformed report file.
 */
export interface CoverageRunner {
  /** Short identifier for logs/params-key, e.g. `"js"`, `"python"`, `"go"`, `"gradle"`, `"sbt"`. */
  readonly name: string;
  /** Cheap, synchronous check: does `dir` look like a project this runner knows how to handle? */
  detect(dir: string): boolean;
  /**
   * Runs the coverage tool in `dir` and returns a map of paths (relative to `dir`, forward-slash
   * separated) to line-coverage percentage (0–100). Returns `null` when the run failed for any
   * reason — the orchestrator logs a warning to stderr and moves on.
   */
  run(dir: string, opts: CoverageRunOptions): Promise<Map<string, number> | null>;
}
