import path from "node:path";
import {
  applyConfig,
  configToGraphOptions,
  getLanguageCoverage,
  languageCaveatsSummary,
  loadCoverageMap,
  loadMokoshConfig,
  summarizeWorkspaceLayout,
} from "../../index";
import type { SessionState } from "../cache";
import type { TextResponse } from "../utils";
import { text } from "../utils";
import type { AnalyzeArgs, ClearCacheArgs } from "./types";

/**
 * @description Builds (or incrementally refreshes) the dependency graph and caches it for
 *   the session. When `entryPoints` is empty, auto-detects whether `root` is a monorepo
 *   and builds a per-package workspace graph if so.
 * @param cache - Session state used to store and retrieve the built graph.
 * @param args - `root` is the project directory; `entryPoints` seeds the graph walk (empty triggers monorepo auto-detect).
 * @returns A lightweight summary of node count, categories, and cycles — call `get_dependencies` or `query` for full graph data.
 */
export async function handleAnalyze(cache: SessionState, args: AnalyzeArgs) {
  const { root, entryPoints } = args;
  if (!cache.isConfigured(root)) {
    const config = loadMokoshConfig(root, { allowJs: false });
    applyConfig(config);
    cache.storeConfig(root, config);
  }

  // Auto-detect monorepo when no entry points are provided
  if (entryPoints.length === 0) {
    const layout = cache.getLayout(root);
    if (layout.type !== "none") {
      const config = cache.getConfig(root);
      const buildOpts = { ...configToGraphOptions(config), packages: args.packages };
      cache.storeLastAnalyze(root, { kind: "workspace" });
      cache.startWatching(root);

      // Progressive default: return the layout immediately and let the per-package graphs
      // build lazily on the first workspace query that needs edges. Full-repo graph builds
      // on large JVM monorepos blow the MCP request timeout, and most sessions only need
      // the package list (see docs/known_issues/02-monorepo-empty-entrypoints-timeout.md).
      if (!args.eager) {
        const builtGraph = cache.hasWorkspace(root) ? cache.requireWorkspace(root) : undefined;
        return text(summarizeWorkspaceLayout(layout, builtGraph));
      }

      const workspaceGraph = await cache.getOrBuildWorkspace(root, buildOpts);
      const perPackage = Array.from(workspaceGraph.packages.values()).map(({ graph, pkg }) => ({
        package: pkg.name,
        relativeRoot: pkg.relativeRoot,
        nodeCount: graph.nodes.size,
      }));
      return text({
        monorepoType: layout.type,
        packageCount: workspaceGraph.packages.size,
        packages: perPackage,
      });
    }
  }

  const resolvedEntries = entryPoints.map((ep) => path.resolve(root, ep));
  const config = cache.getConfig(root);
  const coverageMap = config?.coverageReportPath
    ? loadCoverageMap(root, config.coverageReportPath)
    : new Map<string, number>();
  const graph = await cache.getOrBuild(root, resolvedEntries, coverageMap);
  cache.storeLastAnalyze(root, { kind: "single", entryPoints: resolvedEntries, coverageMap });
  cache.startWatching(root);
  const serialized = graph.serialize();
  const categories = serialized.nodes.reduce<Record<string, number>>((acc, node) => {
    acc[node.category] = (acc[node.category] ?? 0) + 1;
    return acc;
  }, {});
  const cycles = graph.findCycles({ includeKinds: args.cycleKinds });
  const languageCoverage = getLanguageCoverage(graph);
  const caveats = languageCaveatsSummary(graph);
  return text({
    nodeCount: serialized.nodes.length,
    categories,
    cycles,
    languageCoverage,
    ...(caveats.length > 0 && { caveats }),
  });
}

/**
 * @description Drops the cached graph, loaded config, and on-disk workspace cache for `root`.
 *   Call `analyze` again right after this — that's what re-reads `mokosh.config.json` and
 *   rebuilds; calling a different tool first (`query`, `get_affected`, …) instead triggers a
 *   rebuild with *no* config rather than the old one, since config was just dropped and only
 *   `analyze` reloads it. See `SessionState.invalidate`.
 * @param cache - Session state from which the cached graph will be removed.
 * @param args - `root` identifies which project's cache to invalidate.
 * @returns TextResponse with `{ root, cleared, message }` indicating whether a cache entry was present and removed.
 */
export function handleClearCache(cache: SessionState, args: ClearCacheArgs): TextResponse {
  const { root } = args;
  const cleared = cache.invalidate(root);
  return text({
    root,
    cleared,
    message: cleared
      ? "Cache cleared. Call analyze to rebuild."
      : "No cache was present for this root.",
  });
}
