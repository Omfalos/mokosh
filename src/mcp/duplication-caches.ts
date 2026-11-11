import path from "node:path";
import type { MokoshConfig } from "../config";
import { type DuplicationTokenCache, loadTokenCacheFromDisk, saveTokenCacheToDisk } from "../index";
import { duplicationTokenCachePath, resolveDuplicationResultCachePath } from "./cache-paths";

/**
 * @description Session-scoped `find_duplicates` caches: the in-memory token cache per root
 *   (hydrated from / flushed to `mokosh-cache/duplication-tokens.json`) and resolution of the
 *   on-disk result-cache path. Config is read through a callback so this class depends on a
 *   lookup, not on `SessionState`.
 */
export class DuplicationCaches {
  private readonly tokenCaches = new Map<string, DuplicationTokenCache>();

  /**
   * @param configFor - Looks up the loaded config for a root (for `cachePath` overrides).
   */
  constructor(private readonly configFor: (root: string) => MokoshConfig | undefined) {}

  /**
   * @description Returns the token cache for `root`, hydrating from disk on first access this
   *   session. Persists across calls so unchanged files (by `mtime`/`size`) skip re-tokenizing —
   *   see docs/adr-014-duplicate-detection-scale.md. Cleared (in-memory only) by {@link drop}.
   * @param root - Absolute project root path.
   * @returns The mutable token cache for this root.
   */
  getTokenCache(root: string): DuplicationTokenCache {
    let cache = this.tokenCaches.get(root);
    if (!cache) {
      cache = loadTokenCacheFromDisk(duplicationTokenCachePath(root));
      this.tokenCaches.set(root, cache);
    }
    return cache;
  }

  /**
   * @description Persists `root`'s in-memory token cache to disk. Never throws — a write failure
   *   is logged to stderr, since this is a pure performance optimization.
   * @param root - Absolute project root path.
   */
  flush(root: string): void {
    const cache = this.tokenCaches.get(root);
    if (!cache) return;
    try {
      saveTokenCacheToDisk(cache, duplicationTokenCachePath(root));
    } catch (err) {
      process.stderr.write(`Warning: failed to persist duplication token cache: ${err}\n`);
    }
  }

  /**
   * @description Absolute path to `root`'s disk-persisted result cache (per package when
   *   `pkgName` is given). Only resolves the path — callers own load/save.
   * @param root - Absolute project root path.
   * @param pkgName - Workspace package name, when the scan is scoped to one package.
   * @returns The result-cache file path.
   */
  resultCachePath(root: string, pkgName?: string): string {
    return resolveDuplicationResultCachePath(root, this.configFor(root), pkgName);
  }

  /**
   * @description Drops `root`'s in-memory token cache (the on-disk file is self-correcting via
   *   per-entry mtime/size checks).
   * @param root - Absolute project root path.
   */
  drop(root: string): void {
    this.tokenCaches.delete(root);
  }
}
