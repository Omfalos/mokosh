/** Shared "did anything in scope change" digest: one `path\0mtime\0size` line per node, sorted
 *  and sha256'd. Used wherever a disk result cache needs to invalidate on any add/remove/edit
 *  without re-walking the filesystem — the in-memory `FileNode`s already carry `mtime`/`size`.
 *  Originated in `src/graph/duplication/result-cache-store.ts` (`duplicationDigest`), factored
 *  out here so the coverage result cache (`src/graph/coverage/result-cache-store.ts`) can reuse
 *  the exact same unit instead of a parallel implementation. */
import crypto from "node:crypto";

/**
 * @description Computes a stable digest over a set of nodes' `path`/`mtime`/`size`, sorted so
 *   iteration order never affects the result.
 * @param {Iterable<{ path: string; mtime: number; size: number }>} nodes - Graph file nodes (or
 *   any object carrying the same three fields).
 * @returns {string} Hex sha-256 digest.
 */
export function digestNodes(
  nodes: Iterable<{ path: string; mtime: number; size: number }>,
): string {
  const lines: string[] = [];
  for (const node of nodes) lines.push(`${node.path}\0${node.mtime}\0${node.size}`);
  lines.sort();
  const hash = crypto.createHash("sha256");
  for (const line of lines) hash.update(`${line}\n`);
  return hash.digest("hex");
}
