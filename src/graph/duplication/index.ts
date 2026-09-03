/**
 * Cross-file duplicate-code detection. Two matching strategies, picked per file by `FileType`:
 * CSS/Less/SCSS route through `findStyleBlockDuplicates` (`style-blocks.ts`), a structural
 * comparator over PostCSS rule bodies; everything else (including Stylus, which has no shared
 * PostCSS AST here) runs the generic tokenize → suffix-array-exact-match pipeline. See
 * docs/adr-012-duplicate-detection.md for why token-based detection is built in-house instead of
 * adopting jscpd, docs/adr-013-duplicate-detection-noise-reduction.md for why CSS-family matching
 * moved off it, and docs/adr-015-suffix-array-duplicate-detection.md for why matching runs on a
 * suffix array (`suffix-duplicates.ts`) rather than the original hash-shingle-bucket matcher
 * (`shingle.ts`, kept and independently tested but no longer used here).
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
import { hasGeneratedMarker, isGeneratedPath } from "./generated";
import type { DuplicateGroup, DuplicateSignal, FileTokens } from "./shingle";
import { findStyleBlockDuplicates, type StyleSourceFile } from "./style-blocks";
import { findExactDuplicateGroups } from "./suffix-duplicates";
import type { CachedFileTokens, DuplicationTokenCache } from "./token-cache-store";
import type { NormalizedToken } from "./tokenizer";
import { tokenize } from "./tokenizer";

/** Below this many candidate files, worker-pool spin-up cost outweighs the parallelism benefit —
 *  tokenize in-process instead. Mirrors `GraphBuilder`'s `DEFAULT_MIN_FILES_FOR_POOL`. */
const DEFAULT_MIN_FILES_FOR_POOL = 20;

/** Configures whether/how tokenizing is offloaded to a `piscina` worker pool. `false` always
 *  tokenizes in-process. */
export type ParallelTokenizingOption = boolean | { minFiles?: number; maxThreads?: number };

export type { DuplicateFamily } from "./families";
export { hasGeneratedMarker, isGeneratedPath } from "./generated";
export type { DuplicateGroup, DuplicateOccurrence, DuplicateSignal } from "./shingle";
export type { StyleSourceFile } from "./style-blocks";
export type { CachedFileTokens, DuplicationTokenCache } from "./token-cache-store";
export { loadTokenCacheFromDisk, saveTokenCacheToDisk } from "./token-cache-store";

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
  /** When false (default), skip generated / vendored files — protobuf output, `*.generated.*`,
   *  codegen basenames, files under a `generated/` segment, and files whose first ~500 bytes
   *  carry a `@generated` / `DO NOT EDIT` / `Code generated by` marker. Their repetition is not
   *  actionable copy-paste. Set true to scan them anyway; matches involving one are tagged
   *  `signals: ["generated"]`. See docs/adr-013-duplicate-detection-noise-reduction.md. */
  includeGenerated?: boolean | undefined;
  /** Extra generated-file patterns merged with the built-in list (from
   *  `MokoshConfig.duplication.ignoreGlobs`). Two shapes only — `**​/name/**` (path segment) and
   *  `*.suffix` (basename) — not full glob syntax. */
  ignoreGlobs?: readonly string[] | undefined;
  /** Controls worker-pool offloading of per-file tokenizing (default `true`): offloads once the
   *  candidate file count reaches `minFiles` (default 20, matching `GraphBuilder`'s parse pool);
   *  `false` always tokenizes in-process; an object overrides `minFiles`/`maxThreads`. See
   *  docs/adr-014-duplicate-detection-scale.md. */
  parallelTokenizing?: ParallelTokenizingOption | undefined;
  /** Optional caller-owned cache reused across calls against the same root — files whose
   *  `mtime`/`size` are unchanged since the cached entry (and whose `ignoreLiterals` matches this
   *  call's) skip tokenizing entirely. Mutated in place; omit for one-shot callers (e.g. the CLI).
   *  See {@link DuplicationTokenCache} and docs/adr-014-duplicate-detection-scale.md. */
  tokenCache?: DuplicationTokenCache | undefined;
}

export interface FindDuplicatesResult {
  /** Duplicate blocks, largest-first, capped at `limit`. */
  groups: DuplicateGroup[];
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
 * @description Attaches advisory {@link DuplicateSignal}s to a group: `"same-file"` when every
 *   occurrence is in one file, `"generated"` when any occurrence is in a file scanned only
 *   because `includeGenerated: true`.
 * @param group - A finalized duplicate group.
 * @param generatedPaths - Project-relative paths of generated files kept in this scan.
 * @returns The same group with `signals` set when at least one applies, otherwise unchanged.
 */
function withSignals(group: DuplicateGroup, generatedPaths: ReadonlySet<string>): DuplicateGroup {
  const signals: DuplicateSignal[] = [];
  if (new Set(group.occurrences.map((occ) => occ.file)).size === 1) signals.push("same-file");
  if (group.occurrences.some((occ) => generatedPaths.has(occ.file))) signals.push("generated");
  return signals.length > 0 ? { ...group, signals } : group;
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
 *   results; `parallelTokenizing` offloads per-file tokenizing to a worker pool once the
 *   candidate file count is large enough to be worth it. Lock files are always excluded,
 *   independent of `ignoreDirs`.
 * @returns `groups` — duplicate blocks (each tagged with its `family`), two or more occurrences
 *   per block, every block that pairwise chain-matches another clustered into one group instead
 *   of one per pair, sorted largest-first across all families.
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
    limit = 50,
    ignoreDirs = DEFAULT_IGNORE_DIRS,
    includeGenerated = false,
    ignoreGlobs = [],
    parallelTokenizing = true,
    tokenCache,
  } = options;

  const nodes = [...graph.nodes.values()].filter(
    (node) => !isLockFile(node.path) && !isUnderIgnoredDir(node.path, ignoreDirs),
  );

  // Paths kept in the scan only because `includeGenerated: true` — used to tag matches
  // `signals: ["generated"]`. Empty when `includeGenerated` is false (they're dropped instead).
  const generatedPaths = new Set<string>();

  const pool = createTokenizingPool(parallelTokenizing, nodes.length);
  try {
    const structuralStyleFiles: StyleSourceFile[] = [];
    const filesByFamily = new Map<DuplicateFamily, FileTokens[]>();
    await Promise.all(
      nodes.map(async (node) => {
        const pathGenerated = isGeneratedPath(node.path, ignoreGlobs);
        if (pathGenerated && !includeGenerated) return;

        if (STRUCTURAL_STYLE_TYPES.has(node.type)) {
          let source: string;
          try {
            source = await readFile(path.join(rootDir, node.path), "utf8");
          } catch {
            // File listed in the graph but no longer readable (deleted/moved since build) — skip.
            return;
          }
          const generated = pathGenerated || hasGeneratedMarker(source);
          if (generated && !includeGenerated) return;
          if (generated) generatedPaths.add(node.path);
          structuralStyleFiles.push({ file: node.path, source, fileType: node.type });
          return;
        }

        const cached = tokenCache?.get(node.path);
        const cacheHit =
          cached &&
          cached.mtime === node.mtime &&
          cached.size === node.size &&
          cached.ignoreLiterals === ignoreLiterals;

        let tokens: NormalizedToken[];
        let generated: boolean;
        if (cacheHit) {
          tokens = cached.tokens;
          generated = cached.generated;
        } else {
          let source: string;
          try {
            source = await readFile(path.join(rootDir, node.path), "utf8");
          } catch {
            // File listed in the graph but no longer readable (deleted/moved since build) — skip.
            return;
          }
          generated = pathGenerated || hasGeneratedMarker(source);
          if (generated && !includeGenerated) return;
          tokens = pool
            ? await pool.run({ source, fileType: node.type, ignoreLiterals })
            : tokenize(source, node.type, ignoreLiterals);
          tokenCache?.set(node.path, {
            mtime: node.mtime,
            size: node.size,
            ignoreLiterals,
            generated,
            tokens,
          });
        }

        if (generated && !includeGenerated) return;
        if (generated) generatedPaths.add(node.path);

        const family = getDuplicateFamily(node.type);
        const fileTokens: FileTokens = { file: node.path, tokens };
        const bucket = filesByFamily.get(family);
        if (bucket) bucket.push(fileTokens);
        else filesByFamily.set(family, [fileTokens]);
      }),
    );

    if (tokenCache) {
      // Drop entries for files no longer in this scan's candidate set (deleted, moved, or newly
      // excluded by ignoreDirs) so a long-lived session cache doesn't grow unboundedly.
      const current = new Set(nodes.map((node) => node.path));
      for (const cachedPath of tokenCache.keys()) {
        if (!current.has(cachedPath)) tokenCache.delete(cachedPath);
      }
    }

    const groups: DuplicateGroup[] = findStyleBlockDuplicates(structuralStyleFiles, minLines).map(
      (group) => withSignals(group, generatedPaths),
    );

    // Matching never crosses a family boundary (see families.ts) — each family's token stream is
    // suffix-array-matched in isolation, so (e.g.) Stylus can never register as a "duplicate" of
    // an unrelated TS/JS/Python shape, and vice versa.
    for (const [family, fileTokens] of filesByFamily) {
      for (const group of findExactDuplicateGroups(
        fileTokens,
        windowSize,
        minLines,
        maxPunctuationRatio,
      )) {
        groups.push(withSignals({ ...group, family }, generatedPaths));
      }
    }

    return { groups: groups.sort((a, b) => b.lines - a.lines).slice(0, limit) };
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
 *   `maxThreads`. A `maxThreads` below 1 is clamped to 1, with a stderr warning (Piscina's
 *   constructor throws synchronously on a non-positive value).
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

  if (opts.maxThreads !== undefined && opts.maxThreads < 1) {
    process.stderr.write(
      `\nWarning: parallelTokenizing.maxThreads (${opts.maxThreads}) must be at least 1; using 1.\n`,
    );
  }

  try {
    // duplication/index.ts is bundled into dist/index.js (same tsup entry as builder.ts, which
    // relies on the same fact for parse-worker.js — see docs/adr-010-parallel-parsing.md), so
    // __dirname at runtime resolves to dist/, not dist/graph/duplication/.
    return new Piscina({
      filename: path.join(__dirname, "duplication-worker.js"),
      ...(opts.maxThreads !== undefined ? { maxThreads: Math.max(1, opts.maxThreads) } : {}),
    });
  } catch (err) {
    process.stderr.write(
      `\nWarning: failed to start duplicate-detection worker pool, falling back to synchronous tokenizing: ${err}\n`,
    );
    return null;
  }
}
