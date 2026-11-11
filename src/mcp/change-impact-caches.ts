import { buildChangeImpactCache, type ChangeImpactCache, type Graph } from "../index";

/**
 * @description Lazily-built change-impact caches, keyed by an opaque string: `root` for a
 *   single-package graph, `${root}::${packageName}` or `${root}::__flat__` for workspaces.
 */
export class ChangeImpactCaches {
  private readonly caches = new Map<string, ChangeImpactCache>();

  /**
   * @description Returns the cache for `cacheKey`, building it via `buildGraph` on first access.
   * @param cacheKey - Cache key.
   * @param buildGraph - Lazily supplies the `Graph`; only called on a miss.
   * @returns The `ChangeImpactCache` for this key.
   */
  getOrBuild(cacheKey: string, buildGraph: () => Graph): ChangeImpactCache {
    const existing = this.caches.get(cacheKey);
    if (existing) return existing;
    const cache = buildChangeImpactCache(buildGraph());
    this.caches.set(cacheKey, cache);
    return cache;
  }

  /**
   * @description Drops every entry for `root` — the root-keyed entry and every `${root}::…` entry.
   * @param root - Absolute project root path.
   */
  clearFor(root: string): void {
    this.caches.delete(root);
    const prefix = `${root}::`;
    for (const key of this.caches.keys()) {
      if (key.startsWith(prefix)) this.caches.delete(key);
    }
  }
}
