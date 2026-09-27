/** Instant, zero-execution coverage *estimate*: is a file reachable from any test, and how
 *  directly? This is NOT a measurement of which lines actually ran — that's only knowable by
 *  running the code (see `coverage.mode: "exec"` and `docs/adr-023-on-demand-coverage.md`).
 *  It's a static proxy built entirely from graph data already computed during the build (import
 *  edges, call edges, `testedBy`), so it costs nothing beyond the graph traversals below —
 *  no process spawned, no digest cache needed. */

import type { FileNode } from "../../types/node";
import type { Graph } from "../model";

/** Estimated `coveragePct` per reachability tier, most to least direct evidence a file is
 *  actually exercised by a test:
 *  - `DIRECT` — a test file imports this file directly (`testedBy`), or a test's call edges call
 *    directly into it. The strongest static signal available, still not proof every line ran.
 *  - `CALL_REACHABLE` — reachable from a test via the *call* graph, transitively (a function call
 *    chain, not just an import statement) — only meaningful for languages with call edges
 *    (TS/JS, Go, Python, Java; see `docs/language-support.md`).
 *  - `IMPORT_REACHABLE` — reachable from a test via the import graph only; the test transitively
 *    imports this file but no traced call edge reaches it (either the language has no call-edge
 *    support, or the import's exports are never actually invoked in what was traced).
 *  - `UNREACHED` — no test transitively imports this file at all. */
export const STATIC_COVERAGE_TIERS = {
  DIRECT: 100,
  CALL_REACHABLE: 75,
  IMPORT_REACHABLE: 45,
  UNREACHED: 0,
} as const;

/**
 * @description Computes a static, instant coverage estimate for every node in `graph`: how
 *   directly each file is reachable from a test file, per {@link STATIC_COVERAGE_TIERS}. Test
 *   files themselves are scored `DIRECT` (they run in full whenever the suite runs). Returns an
 *   empty map when the graph has no test files at all — same "no data" contract `loadCoverageMap`
 *   uses for a missing report, so callers don't mistake "no tests exist" for "0% everywhere."
 * @param graph - The built graph (or a monorepo's flattened graph) to estimate coverage for.
 * @returns Map of project-relative path → estimated `coveragePct`.
 */
export function computeStaticCoverage(graph: Graph): Map<string, number> {
  const result = new Map<string, number>();
  const testPaths = [...graph.nodes.values()]
    .filter((node) => node.category === "test")
    .map((node) => node.path);
  if (testPaths.length === 0) return result;

  const importReachable = new Set<string>();
  const callReachable = new Set<string>();
  // One-hop callees of a test's own call edges — evidence a test's own code calls straight into
  // this file, as strong a signal as a direct import (`testedBy`).
  const directCall = new Set<string>();
  for (const testPath of testPaths) {
    graph.traverse(
      testPath,
      (node) => {
        if (node.path !== testPath) importReachable.add(node.path);
        return true;
      },
      { direction: "outgoing" },
    );
    graph.traverseCalls(
      testPath,
      (node, depth) => {
        if (node.path !== testPath) {
          callReachable.add(node.path);
          if (depth === 1) directCall.add(node.path);
        }
        return true;
      },
      { direction: "outgoing" },
    );
  }

  for (const node of graph.nodes.values()) {
    if (node.category === "test") {
      result.set(node.path, STATIC_COVERAGE_TIERS.DIRECT);
      continue;
    }
    if ((node.testedBy?.length ?? 0) > 0 || directCall.has(node.path)) {
      result.set(node.path, STATIC_COVERAGE_TIERS.DIRECT);
    } else if (callReachable.has(node.path)) {
      result.set(node.path, STATIC_COVERAGE_TIERS.CALL_REACHABLE);
    } else if (importReachable.has(node.path)) {
      result.set(node.path, STATIC_COVERAGE_TIERS.IMPORT_REACHABLE);
    } else {
      result.set(node.path, STATIC_COVERAGE_TIERS.UNREACHED);
    }
  }
  return result;
}

/**
 * @description Computes and applies the static coverage estimate to `graph` in place: every
 *   node gets `coveragePct` from {@link computeStaticCoverage} and `coverageSource: "static"`, so
 *   consumers can tell it apart from a real measurement. A no-op (nothing set) when the graph has
 *   no test files.
 * @param graph - The graph to enrich in place.
 */
export function applyStaticCoverage(graph: Graph): void {
  const estimate = computeStaticCoverage(graph);
  for (const [path, pct] of estimate) {
    const node: FileNode | undefined = graph.nodes.get(path);
    if (!node) continue;
    node.coveragePct = pct;
    node.coverageSource = "static";
  }
}
