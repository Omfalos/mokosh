/**
 * Cross-file duplicate-code detection. Two matching strategies, picked per file by `FileType`:
 * CSS/Less/SCSS route through `findStyleBlockDuplicates` (`style-blocks.ts`), a structural
 * comparator over PostCSS rule bodies; everything else (including Stylus, which has no shared
 * PostCSS AST here) runs the generic tokenize → shingle → chain-merge pipeline. See
 * docs/adr-012-duplicate-detection.md for why the shingle pipeline is built in-house instead of
 * adopting jscpd, and docs/adr-013-duplicate-detection-noise-reduction.md for why CSS-family
 * matching moved off it.
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
import type { FileType } from "../../types/parse";
import type { Graph } from "../model";
import { type DuplicateFamily, getDuplicateFamily } from "./families";
import { type DuplicateGroup, type FileTokens, findDuplicateGroups } from "./shingle";
import { findStyleBlockDuplicates, type StyleSourceFile } from "./style-blocks";
import { tokenize } from "./tokenizer";

export type { DuplicateFamily } from "./families";
export type { DuplicateGroup, DuplicateOccurrence } from "./shingle";
export type { StyleSourceFile } from "./style-blocks";

/** CSS-family types with a shared PostCSS AST available — routed through the structural rule-body
 *  comparator instead of the generic token-shingle pipeline. Stylus has no such AST here, so it
 *  stays on the token-shingle path (still isolated to the `"style"` family, see `families.ts`). */
const STRUCTURAL_STYLE_TYPES: ReadonlySet<FileType> = new Set<FileType>(["css", "scss", "less"]);

export interface FindDuplicatesOptions {
  /** Minimum duplicated block size, in source lines, to report (default 6). */
  minLines?: number | undefined;
  /** Shingle window size, in tokens — the smallest duplicate the scan can detect (default 15). */
  windowSize?: number | undefined;
  /** When true (default), string/number literals are normalized too, so only structural shape
   *  — not the specific values used — drives a match. Set false for stricter, Type-1-only matching. */
  ignoreLiterals?: boolean | undefined;
  /** Maximum fraction of a token-shingled block's window that may be object/array-literal
   *  structural punctuation (`{ } : , [ ]`) (default 0.5) — gates out blocks that are mostly
   *  schema/object-literal shape (e.g. MCP tool `inputSchema` boilerplate repeated across
   *  unrelated tool definitions) rather than substantive shared logic. Does not apply to the
   *  CSS/Less/SCSS structural comparator, which already matches on literal declaration content.
   *  Set to 1 to disable. See docs/adr-013-duplicate-detection-noise-reduction.md. */
  maxPunctuationRatio?: number | undefined;
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
 *   duplicated code. CSS/Less/SCSS files are compared structurally — by their rule bodies'
 *   literal, ordered `property: value` declarations, independent of selector name — via
 *   {@link findStyleBlockDuplicates}. Every other language (TS/JS, Python, Go, CoffeeScript,
 *   LiveScript, Lua, Gherkin, Markdown, and Stylus, which has no shared PostCSS AST here) runs
 *   the generic token-shingling pipeline instead: comments are stripped per `FileType`,
 *   identifiers (and, by default, literals) are normalized to placeholders so renamed-variable
 *   copies still match, then a sliding token window is hashed and chain-merged into contiguous
 *   blocks. Token-shingled files are additionally partitioned into language families
 *   ({@link getDuplicateFamily} — `"style"` for Stylus, `"code"` for everything else) so
 *   matching never crosses that boundary — see docs/adr-013-duplicate-detection-noise-reduction.md.
 * @param graph - The graph to scan; its node paths (already ignore-rule-filtered) are the file
 *   list, re-read from disk since duplication data isn't cached on `FileNode`.
 * @param rootDir - Absolute project root that graph paths are relative to.
 * @param options - `minLines`/`windowSize` tune token-shingle sensitivity (`minLines` also caps
 *   CSS/Less/SCSS block size); `ignoreLiterals` toggles Type-2 vs Type-1 matching for the
 *   token-shingle path only (CSS/Less/SCSS always match on literal declaration content);
 *   `maxPunctuationRatio` gates out token-shingle blocks that are mostly object/array-literal
 *   structural punctuation (e.g. schema/object-literal boilerplate) rather than substantive
 *   shared logic; `ignoreDirs` excludes files under matching directory names; `limit` caps
 *   results. Lock files are always excluded, independent of `ignoreDirs`.
 * @returns Duplicate blocks (each tagged with its `family`), two or more occurrences per block —
 *   every block that pairwise chain-matches another is clustered into one group instead of one
 *   per pair — sorted largest-first across all families.
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
    maxPunctuationRatio = 0.5,
    limit = 50,
    ignoreDirs = DEFAULT_IGNORE_DIRS,
  } = options;

  const nodes = [...graph.nodes.values()].filter(
    (node) => !isLockFile(node.path) && !isUnderIgnoredDir(node.path, ignoreDirs),
  );
  const structuralStyleFiles: StyleSourceFile[] = [];
  const filesByFamily = new Map<DuplicateFamily, FileTokens[]>();
  await Promise.all(
    nodes.map(async (node) => {
      let source: string;
      try {
        source = await readFile(path.join(rootDir, node.path), "utf8");
      } catch {
        // File listed in the graph but no longer readable (deleted/moved since build) — skip.
        return;
      }

      if (STRUCTURAL_STYLE_TYPES.has(node.type)) {
        structuralStyleFiles.push({ file: node.path, source, fileType: node.type });
        return;
      }

      const family = getDuplicateFamily(node.type);
      const fileTokens: FileTokens = {
        file: node.path,
        tokens: tokenize(source, node.type, ignoreLiterals),
      };
      const bucket = filesByFamily.get(family);
      if (bucket) bucket.push(fileTokens);
      else filesByFamily.set(family, [fileTokens]);
    }),
  );

  const groups: DuplicateGroup[] = findStyleBlockDuplicates(structuralStyleFiles, minLines);

  // Token-shingle matching never crosses a family boundary (see families.ts) — each family's
  // shingle windows are hashed and chain-merged in isolation, so (e.g.) Stylus can never register
  // as a "duplicate" of an unrelated TS/JS/Python shape, and vice versa.
  for (const [family, fileTokens] of filesByFamily) {
    for (const group of findDuplicateGroups(
      fileTokens,
      windowSize,
      minLines,
      maxPunctuationRatio,
    )) {
      groups.push({ ...group, family });
    }
  }

  return groups.sort((a, b) => b.lines - a.lines).slice(0, limit);
}
