/**
 * `DuplicationTokenCache` — `findDuplicates`'s per-file tokenize-result cache — and its disk
 * persistence, mirroring `src/cli/graph-loader.ts`'s load/save shape (sync JSON read/write,
 * `mkdir -p` on save, correctness via per-entry mtime/size checks at read time rather than
 * whole-file staleness tracking). The type and its store live in the same module (rather than the
 * type living in `./index.ts`) so `index.ts` can import both from here without a cycle.
 *
 * The in-memory cache already survives repeated `findDuplicates` calls within one MCP session
 * (caller-owned — see `DuplicationTokenCache`'s doc below), but starts empty again on every new
 * session and every CLI invocation. This module lets both the MCP server (`src/mcp/cache.ts`) and
 * the CLI (`src/cli/commands/find-duplicates.ts`)
 * persist that cache to `<root>/mokosh-cache/duplication-tokens.json` so a fresh session/process
 * only pays tokenizing cost for files that changed since the cache was last written.
 *
 * Unlike `loadGraphFromCache`, reading here never throws: a token cache is pure acceleration, so
 * any missing, corrupt, or wrong-shaped file degrades to an empty `Map` (i.e. today's cold-start
 * behavior) rather than breaking the CLI command or MCP tool call that triggered the read.
 */
import fs from "node:fs";
import path from "node:path";
import type { NormalizedToken } from "./tokenizer";

/** One file's cached tokenize result, fingerprinted by `mtime`/`size`/`ignoreLiterals` — any
 *  mismatch against the current `FileNode` (or against the `ignoreLiterals` this scan is running
 *  with) means the entry is stale and must be recomputed, exactly like `GraphBuilder`'s
 *  mtime+size node reuse for incremental graph builds. */
export interface CachedFileTokens {
  mtime: number;
  size: number;
  ignoreLiterals: boolean;
  tokens: NormalizedToken[];
}

/** Caller-owned cache, keyed by project-relative path, reused across repeated `findDuplicates`
 *  calls against the same root (e.g. successive MCP tool calls in one session) so unchanged files
 *  never pay tokenizing cost twice. `findDuplicates` itself is stateless — callers that want this
 *  benefit own the `Map` and pass it in; the CLI's one-shot process has nothing to gain and omits
 *  it. See docs/adr-014-duplicate-detection-scale.md. */
export type DuplicationTokenCache = Map<string, CachedFileTokens>;

function isCachedFileTokens(value: unknown): value is CachedFileTokens {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CachedFileTokens>;
  return (
    typeof candidate.mtime === "number" &&
    typeof candidate.size === "number" &&
    typeof candidate.ignoreLiterals === "boolean" &&
    Array.isArray(candidate.tokens)
  );
}

/**
 * @description Reads a serialized `DuplicationTokenCache` from a JSON disk file written by
 *   `saveTokenCacheToDisk`. Any problem reading or parsing the file — missing, corrupt JSON,
 *   or a value that doesn't look like `[path, CachedFileTokens][]` — degrades to an empty `Map`
 *   instead of throwing, since a token cache is pure acceleration, never a source of truth.
 * @param cachePath - Path to the JSON file written by `saveTokenCacheToDisk`.
 * @returns The reconstituted `DuplicationTokenCache`, empty if nothing usable was found.
 */
export function loadTokenCacheFromDisk(cachePath: string): DuplicationTokenCache {
  try {
    if (!fs.existsSync(cachePath)) return new Map();
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const entries = parsed.filter(
      (entry): entry is [string, CachedFileTokens] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        isCachedFileTokens(entry[1]),
    );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/**
 * @description Serializes a `DuplicationTokenCache` to JSON and writes it to disk, creating any
 *   missing parent directories. Callers should save the same `Map` `findDuplicates` already
 *   prunes to the current candidate file set after each scan (see `./index.ts`'s post-scan
 *   pruning), so the file never grows to hold stale entries beyond what the in-memory cache
 *   already holds — no separate pruning step is needed here.
 * @param cache - The token cache to persist.
 * @param cachePath - Destination path; parent directories are created automatically.
 */
export function saveTokenCacheToDisk(cache: DuplicationTokenCache, cachePath: string): void {
  const cacheDir = path.dirname(cachePath);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(cachePath, JSON.stringify([...cache.entries()]));
}
