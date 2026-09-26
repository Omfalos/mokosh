/** Tool-facing helpers that route a language question to its adapter's hook, or a generic default. */
import type { FileNode } from "../types/node";
import type { FileType } from "../types/parse";
import { inferJsExportKind } from "./hooks/export-kind";
import { getAdapter, LANGUAGE_ADAPTERS } from "./registry";
import type { ExportKind } from "./types";

/**
 * @description Classifies an export using the defining file's language hook.
 * @param {FileType | undefined} type - Language of the file defining the export.
 * @param {string | undefined} signature - Raw signature string from an `ExportedSymbol`.
 * @returns {ExportKind} The export kind, `"unknown"` when the signature is absent or unrecognised.
 */
export function exportKindFor(
  type: FileType | undefined,
  signature: string | undefined,
): ExportKind {
  const hook = type ? getAdapter(type).hooks?.exportKind : undefined;
  return (hook ?? inferJsExportKind)(signature);
}

const GENERIC_TEST_DIR = /(^|\/)(test|tests|__tests__|testdata)\//;
const GENERIC_TEST_SUFFIX = /[._-](test|spec)\.[^/]+$/;

/**
 * @description Path-based test detection, for layouts the category classifier may not cover:
 *   generic test directories and `.test`/`.spec` suffixes, plus each language's own convention
 *   (e.g. Go's `*_test.go`).
 * @param {string} relPath - Project-relative path.
 * @returns {boolean} Whether the path looks like a test file.
 */
export function looksLikeTestPath(relPath: string): boolean {
  if (GENERIC_TEST_DIR.test(relPath) || GENERIC_TEST_SUFFIX.test(relPath)) return true;
  return LANGUAGE_ADAPTERS.some((adapter) => adapter.hooks?.isTestPath?.(relPath));
}

/**
 * @description Entry-point heuristic for projects without a `package.json` `exports`/`main`: the
 *   first language group (in registry order) that has non-test source files decides. Languages of
 *   one family are pooled (java/kotlin/scala/groovy form one group) and the group's first adapter
 *   with an `entryPoints` hook picks the entries.
 * @param {Iterable<FileNode>} nodes - Every node of the graph.
 * @returns {string[]} Project-relative entry-point paths; empty if no group has an entry-point hook.
 */
export function detectNonJsEntryPoints(nodes: Iterable<FileNode>): string[] {
  const all = [...nodes].filter(
    (node) => node.category !== "test" && !looksLikeTestPath(node.path),
  );
  const seen = new Set<string>();
  for (const adapter of LANGUAGE_ADAPTERS) {
    const key = adapter.family ?? adapter.type;
    if (seen.has(key)) continue;
    seen.add(key);
    const hook = adapter.hooks?.entryPoints;
    if (!hook) continue;
    const members = new Set(
      LANGUAGE_ADAPTERS.filter((other) => (other.family ?? other.type) === key).map(
        (other) => other.type,
      ),
    );
    const sources = all.filter((node) => members.has(node.type));
    if (sources.length > 0) return hook(sources);
  }
  return [];
}
