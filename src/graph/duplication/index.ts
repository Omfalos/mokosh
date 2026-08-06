/**
 * Cross-file duplicate-code detection. Language-agnostic by design: reads whatever files are
 * already in `graph.nodes` and runs the same tokenize → shingle → chain-merge pipeline
 * regardless of `FileType`. See docs/adr-012-duplicate-detection.md for why this is built
 * in-house instead of adopting jscpd.
 *
 * `graph.nodes` is not a reliable ignore-rule-filtered file list: `DEFAULT_IGNORE_DIRS` and
 * extension filtering only gate `GraphBuilder`'s own FS-walk discovery passes, not files that
 * become reachable via a resolved reference (an import, or — for Markdown — a code-span file
 * reference per ADR-009). A doc that merely *mentions* `dist/parse-worker.js` in backticks can
 * pull that build artifact into the graph as a real node, ignore-dir or extension notwithstanding.
 * So this module applies its own filtering rather than trusting the graph's membership.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IGNORE_DIRS } from "../../const";
import { LOCK_FILE_NAMES } from "../../parser/lockfile";
import type { Graph } from "../model";
import { type DuplicateGroup, type FileTokens, findDuplicateGroups } from "./shingle";
import { tokenize } from "./tokenizer";

export type { DuplicateGroup, DuplicateOccurrence } from "./shingle";

export interface FindDuplicatesOptions {
  /** Minimum duplicated block size, in source lines, to report (default 6). */
  minLines?: number | undefined;
  /** Shingle window size, in tokens — the smallest duplicate the scan can detect (default 15). */
  windowSize?: number | undefined;
  /** When true (default), string/number literals are normalized too, so only structural shape
   *  — not the specific values used — drives a match. Set false for stricter, Type-1-only matching. */
  ignoreLiterals?: boolean | undefined;
  /** Caps the number of duplicate blocks returned, largest-first (default 50). */
  limit?: number | undefined;
  /** Directory names to exclude, matched against any path segment (default `DEFAULT_IGNORE_DIRS`
   *  — `node_modules`, `dist`, `.git`, `mokosh-cache`, `coverage`, etc.). Pass `[]` to disable. */
  ignoreDirs?: readonly string[] | undefined;
}

/**
 * @description Lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) contain large
 *   blocks of genuinely repeated JSON/YAML structure — every dependency entry looks like every
 *   other one — but that's not code duplication, and it swamps real findings by sheer line
 *   count. Excluded regardless of `ignoreDirs`, since lock files sit at the project root, not in
 *   an ignorable directory.
 * @param relPath - Project-relative file path.
 * @returns Whether `relPath`'s basename is a known lock file.
 */
function isLockFile(relPath: string): boolean {
  return LOCK_FILE_NAMES.includes(path.basename(relPath));
}

/**
 * @description Whether any path segment of `relPath` matches an ignored directory name.
 * @param relPath - Project-relative file path.
 * @param ignoreDirs - Directory names to treat as excluded.
 * @returns `true` if `relPath` lives under one of `ignoreDirs`.
 */
function isUnderIgnoredDir(relPath: string, ignoreDirs: readonly string[]): boolean {
  if (ignoreDirs.length === 0) return false;
  const ignored = new Set(ignoreDirs);
  return relPath.split(path.sep).some((segment) => ignored.has(segment));
}

/**
 * @description Scans every file already present in `graph` for cross-file (and within-file)
 *   duplicated code, using a language-agnostic token-shingling pipeline: comments are stripped
 *   per `FileType`, identifiers (and, by default, literals) are normalized to placeholders so
 *   renamed-variable copies still match, then a sliding token window is hashed and chain-merged
 *   into contiguous blocks. Works uniformly across every language in `DEFAULT_EXTENSIONS`.
 * @param graph - The graph to scan; its node paths (already ignore-rule-filtered) are the file
 *   list, re-read from disk since duplication data isn't cached on `FileNode`.
 * @param rootDir - Absolute project root that graph paths are relative to.
 * @param options - `minLines`/`windowSize` tune sensitivity; `ignoreLiterals` toggles Type-2 vs
 *   Type-1 matching; `ignoreDirs` excludes files under matching directory names; `limit` caps
 *   results. Lock files are always excluded, independent of `ignoreDirs`.
 * @returns Duplicate blocks, each a pair of occurrences, sorted largest-first.
 */
export async function findDuplicates(
  graph: Graph,
  rootDir: string,
  options: FindDuplicatesOptions = {},
): Promise<DuplicateGroup[]> {
  const {
    minLines = 6,
    windowSize = 15,
    ignoreLiterals = true,
    limit = 50,
    ignoreDirs = DEFAULT_IGNORE_DIRS,
  } = options;

  const nodes = [...graph.nodes.values()].filter(
    (node) => !isLockFile(node.path) && !isUnderIgnoredDir(node.path, ignoreDirs),
  );
  const fileTokens: FileTokens[] = (
    await Promise.all(
      nodes.map(async (node): Promise<FileTokens | undefined> => {
        try {
          const source = await readFile(path.join(rootDir, node.path), "utf8");
          return { file: node.path, tokens: tokenize(source, node.type, ignoreLiterals) };
        } catch {
          // File listed in the graph but no longer readable (deleted/moved since build) — skip.
          return undefined;
        }
      }),
    )
  ).filter((ft): ft is FileTokens => ft !== undefined);

  return findDuplicateGroups(fileTokens, windowSize, minLines).slice(0, limit);
}
