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
 *
 * On large repos, tokenizing thousands of files in-process can itself take long enough to blow
 * past an MCP client's response timeout, so tokenizing is optionally offloaded to a `piscina`
 * worker pool — same pattern and same threshold rationale as `GraphBuilder`'s `parseFile` pool,
 * see docs/adr-010-parallel-parsing.md and docs/adr-014-duplicate-detection-scale.md.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import Piscina from "piscina";
import { DEFAULT_IGNORE_DIRS } from "../../const";
import { LOCK_FILE_NAMES } from "../../parser/lockfile";
import type { FileType } from "../../types/parse";
import type { Graph } from "../model";
import { type DuplicateFamily, getDuplicateFamily } from "./families";
import { type DuplicateGroup, type FileTokens, findDuplicateGroups } from "./shingle";
import { findStyleBlockDuplicates, type StyleSourceFile } from "./style-blocks";
import { tokenize } from "./tokenizer";

/** Below this many candidate files, worker-pool spin-up cost outweighs the parallelism benefit —
 *  tokenize in-process instead. Mirrors `GraphBuilder`'s `DEFAULT_MIN_FILES_FOR_POOL`. */
const DEFAULT_MIN_FILES_FOR_POOL = 20;

/** Configures whether/how tokenizing is offloaded to a `piscina` worker pool. `false` always
 *  tokenizes in-process. */
export type ParallelTokenizingOption = boolean | { minFiles?: number; maxThreads?: number };

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
  /** Skip a hash bucket's O(k²) pairwise comparison once it holds more than this many locations
   *  (default 400) — bounds worst-case scan time on large repos where a single ubiquitous token
   *  window (a common import line, a boilerplate header) would otherwise blow past what a single
   *  scan can finish in. Set `Infinity` to disable. See docs/adr-014-duplicate-detection-scale.md. */
  maxBucketSize?: number | undefined;
  /** Caps the number of duplicate blocks returned, largest-first (default 50). */
  limit?: number | undefined;
  /** Directory names to exclude, matched against any path segment (default `DEFAULT_IGNORE_DIRS`
   *  — `node_modules`, `dist`, `.git`, `mokosh-cache`, `coverage`, etc.). Pass `[]` to disable. */
  ignoreDirs?: readonly string[] | undefined;
  /** Controls worker-pool offloading of per-file tokenizing (default `true`): offloads once the
   *  candidate file count reaches `minFiles` (default 20, matching `GraphBuilder`'s parse pool);
   *  `false` always tokenizes in-process; an object overrides `minFiles`/`maxThreads`. See
   *  docs/adr-014-duplicate-detection-scale.md. */
  parallelTokenizing?: ParallelTokenizingOption | undefined;
}

export interface FindDuplicatesResult {
  /** Duplicate blocks, largest-first, capped at `limit`. */
  groups: DuplicateGroup[];
  /** How many hash buckets were skipped for exceeding `maxBucketSize` — a non-zero count means
   *  results may under-report duplication that's unusually widespread (see `maxBucketSize`). */
  skippedBuckets: number;
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
 *   shared logic; `maxBucketSize` bounds worst-case scan time on large repos by skipping
 *   pathologically common hash buckets; `ignoreDirs` excludes files under matching directory
 *   names; `limit` caps results; `parallelTokenizing` offloads per-file tokenizing to a worker
 *   pool once the candidate file count is large enough to be worth it. Lock files are always
 *   excluded, independent of `ignoreDirs`.
 * @returns `groups` — duplicate blocks (each tagged with its `family`), two or more occurrences
 *   per block, every block that pairwise chain-matches another clustered into one group instead
 *   of one per pair, sorted largest-first across all families — plus `skippedBuckets` (see
 *   {@link FindDuplicatesResult}).
 */
export async function findDuplicates(
  graph: Graph,
  rootDir: string,
  options: FindDuplicatesOptions = {},
): Promise<FindDuplicatesResult> {
  const {
    minLines = 6,
    windowSize = 15,
    ignoreLiterals = true,
    maxPunctuationRatio = 0.5,
    maxBucketSize,
    limit = 50,
    ignoreDirs = DEFAULT_IGNORE_DIRS,
    parallelTokenizing = true,
  } = options;

  const nodes = [...graph.nodes.values()].filter(
    (node) => !isLockFile(node.path) && !isUnderIgnoredDir(node.path, ignoreDirs),
  );

  const pool = createTokenizingPool(parallelTokenizing, nodes.length);
  try {
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
        const tokens = pool
          ? await pool.run({ source, fileType: node.type, ignoreLiterals })
          : tokenize(source, node.type, ignoreLiterals);
        const fileTokens: FileTokens = { file: node.path, tokens };
        const bucket = filesByFamily.get(family);
        if (bucket) bucket.push(fileTokens);
        else filesByFamily.set(family, [fileTokens]);
      }),
    );

    const groups: DuplicateGroup[] = findStyleBlockDuplicates(structuralStyleFiles, minLines);
    let skippedBuckets = 0;

    // Token-shingle matching never crosses a family boundary (see families.ts) — each family's
    // shingle windows are hashed and chain-merged in isolation, so (e.g.) Stylus can never
    // register as a "duplicate" of an unrelated TS/JS/Python shape, and vice versa.
    for (const [family, fileTokens] of filesByFamily) {
      const result = findDuplicateGroups(
        fileTokens,
        windowSize,
        minLines,
        maxPunctuationRatio,
        maxBucketSize,
      );
      skippedBuckets += result.skippedBuckets;
      for (const group of result.groups) {
        groups.push({ ...group, family });
      }
    }

    return { groups: groups.sort((a, b) => b.lines - a.lines).slice(0, limit), skippedBuckets };
  } finally {
    if (pool) await pool.destroy();
  }
}

/**
 * @description Decides whether to spin up a worker pool for tokenizing this scan's candidate
 *   files, and constructs it if so — same shape as `GraphBuilder`'s `parseFile` pool (see
 *   docs/adr-010-parallel-parsing.md), reused here because tokenizing thousands of files
 *   in-process can itself take long enough to matter on a large repo. Pool construction is
 *   wrapped in try/catch — a spawn failure (e.g. a sandboxed environment without `worker_threads`
 *   permission) falls back to synchronous in-process tokenizing for the whole scan.
 * @param option - `false` always tokenizes in-process; `true`/omitted offloads once
 *   `candidateFileCount` reaches `minFiles` (default 20); an object overrides `minFiles`/
 *   `maxThreads`.
 * @param candidateFileCount - Number of files this scan will tokenize, already known up front
 *   (unlike `GraphBuilder`'s discovery-driven traversal), so no pre-scan walk is needed here.
 */
function createTokenizingPool(
  option: ParallelTokenizingOption,
  candidateFileCount: number,
): Piscina | null {
  if (option === false) return null;

  const opts = typeof option === "object" ? option : {};
  const minFiles = opts.minFiles ?? DEFAULT_MIN_FILES_FOR_POOL;
  if (candidateFileCount < minFiles) return null;

  try {
    // duplication/index.ts is bundled into dist/index.js (same tsup entry as builder.ts, which
    // relies on the same fact for parse-worker.js — see docs/adr-010-parallel-parsing.md), so
    // __dirname at runtime resolves to dist/, not dist/graph/duplication/.
    return new Piscina({
      filename: path.join(__dirname, "duplication-worker.js"),
      ...(opts.maxThreads !== undefined ? { maxThreads: opts.maxThreads } : {}),
    });
  } catch (err) {
    process.stderr.write(
      `\nWarning: failed to start duplicate-detection worker pool, falling back to synchronous tokenizing: ${err}\n`,
    );
    return null;
  }
}
