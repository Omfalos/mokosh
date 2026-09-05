/**
 * Cross-file duplicate-code detection. Three matching strategies, picked per file by `FileType`:
 * CSS/Less/SCSS route through `findStyleBlockDuplicates` (`style-blocks.ts`), a structural
 * comparator over PostCSS rule bodies; everything else (including Stylus, which has no shared
 * PostCSS AST here) runs the generic tokenize → suffix-array-exact-match pipeline; on top of
 * both, declaration-level matching runs independently — `findStyleVarDuplicates`
 * (`style-vars.ts`) for CSS/SCSS/Less design tokens, `findTypeDefDuplicates` (`type-defs.ts`) for
 * TypeScript `interface`/`type` object shapes, `findObjectLiteralDuplicates`
 * (`object-literals.ts`) for content-identical `const` object literals, `findJsxElementDuplicates`
 * (`jsx-elements.ts`) for content-identical JSX/TSX element trees — the latter two across TS *and*
 * JS files — reported as `kind: "definition"` groups alongside the `kind: "block"` (or absent-`kind`) matches
 * the first two strategies produce. See docs/adr-012-duplicate-detection.md for why token-based
 * detection is built in-house instead of adopting jscpd,
 * docs/adr-013-duplicate-detection-noise-reduction.md for why CSS-family matching moved off it,
 * docs/adr-015-suffix-array-duplicate-detection.md for why matching runs on a suffix array
 * (`suffix-duplicates.ts`) rather than the original hash-shingle-bucket matcher (`shingle.ts`,
 * kept and independently tested but no longer used here), and
 * docs/adr-018-per-language-definition-duplicates.md for the declaration-level strategy.
 *
 * `graph.nodes` is not a reliable ignore-rule-filtered file list: `DEFAULT_IGNORE_DIRS` and
 * extension filtering only gate `GraphBuilder`'s own FS-walk discovery passes, not files that
 * become reachable via a resolved reference (an import, or — for Markdown — a code-span file
 * reference per ADR-009). A doc that merely *mentions* `dist/parse-worker.js` in backticks can
 * pull that build artifact into the graph as a real node, ignore-dir or extension notwithstanding.
 * So this module applies its own filtering rather than trusting the graph's membership.
 *
 * That same reference-driven discovery also pulls non-code *assets* into the graph: an explicit
 * `import Icon from "./x.svg"` resolves (the resolver tries the bare path before any extension —
 * see `resolveLocalPath`) to a real `FileNode` with `type: "unknown"`, and an icon set is dozens
 * of near-identical `<svg><path/></svg>` files. `tokenize()` has no comment/import rules for
 * `"unknown"` — it just splits the raw markup — so those files (and any other `"unknown"` type:
 * `.json`, images, `.c`/`.cpp` until a real parser exists) would flood `groups` with matches that
 * aren't source duplication at all. They're dropped up front here, unconditionally.
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
import { buildDuplicateClusters, type DuplicateCluster } from "./clusters";
import { type DuplicateFamily, getDuplicateFamily } from "./families";
import { hasGeneratedMarker, isGeneratedPath } from "./generated";
import { findJsxElementDuplicates } from "./jsx-elements";
import { findObjectLiteralDuplicates } from "./object-literals";
import type { DuplicateGroup, DuplicateSignal, FileTokens } from "./shingle";
import { findStyleBlockDuplicates, type StyleSourceFile } from "./style-blocks";
import { findStyleVarDuplicates } from "./style-vars";
import { findExactDuplicateGroups } from "./suffix-duplicates";
import { isSvgMarkupSpan } from "./svg-markup";
import type { CachedFileTokens, DuplicationTokenCache } from "./token-cache-store";
import type { NormalizedToken } from "./tokenizer";
import { tokenize } from "./tokenizer";
import { findTypeDefDuplicates, type TypeScriptSourceFile } from "./type-defs";

/** Below this many candidate files, worker-pool spin-up cost outweighs the parallelism benefit —
 *  tokenize in-process instead. Mirrors `GraphBuilder`'s `DEFAULT_MIN_FILES_FOR_POOL`. */
const DEFAULT_MIN_FILES_FOR_POOL = 20;

/** Configures whether/how tokenizing is offloaded to a `piscina` worker pool. `false` always
 *  tokenizes in-process. */
export type ParallelTokenizingOption = boolean | { minFiles?: number; maxThreads?: number };

export type { DuplicateCluster } from "./clusters";
export type { DuplicateFamily } from "./families";
export { hasGeneratedMarker, isGeneratedPath } from "./generated";
export type { DuplicateGroup, DuplicateOccurrence, DuplicateSignal } from "./shingle";
export type { StyleSourceFile } from "./style-blocks";
export type { CachedFileTokens, DuplicationTokenCache } from "./token-cache-store";
export { loadTokenCacheFromDisk, saveTokenCacheToDisk } from "./token-cache-store";
export type { TypeScriptSourceFile } from "./type-defs";

/** CSS-family types with a shared PostCSS AST available — routed through the structural rule-body
 *  comparator instead of the generic token-shingle pipeline. Stylus has no such AST here, so it
 *  stays on the token-shingle path (still isolated to the `"style"` family, see `families.ts`). */
const STRUCTURAL_STYLE_TYPES: ReadonlySet<FileType> = new Set<FileType>(["css", "scss", "less"]);

/** A path that belongs to a test: a `__tests__` / `__mocks__` / `__snapshots__` / `test` /
 *  `tests` / `e2e` directory segment, a `.test.` / `.spec.` basename infix (so
 *  `Foo-e2e.test.stories.tsx` counts too, not just `Foo.test.ts`), or a `.snap` snapshot.
 *  Matched against project-relative, `/`-separated paths — `findDuplicates` normalizes
 *  separators before use. */
const TEST_PATH =
  /(?:^|\/)(?:__tests__|__mocks__|__snapshots__|tests?|e2e)\/|\.(?:test|spec)\.[^/]*$|\.snap$/;

/** `scope: "tests"` keeps a test cluster only if it clears one of these bars — the point is to
 *  surface shared setup / mocks / assertions worth extracting, not the `render(<X/>);
 *  expect(…).toMatchSnapshot()` skeleton every component test repeats. */
const TEST_SUBSTANTIVE_BLOCKS = 3;
const TEST_SUBSTANTIVE_MAX_FILES = 6;
const TEST_SUBSTANTIVE_TOKENS = 120;

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
  /** When false (default), skip matches where every occurrence is in a single file — a file's
   *  own naturally repetitive structure (a long class with many similar methods, a Markdown doc
   *  table, a big object literal) shows up as "duplicating itself" far more often than it
   *  represents an actionable copy-paste bug. Dogfooding found this was the single largest noise
   *  class in `groups` (32% in one measurement). Set true to see them anyway; they're always
   *  tagged `signals: ["same-file"]` regardless of this flag, so a caller already relying on that
   *  tag to filter manually is unaffected either way. Mirrors `includeGenerated`'s
   *  default-off/opt-in-back-in shape. */
  includeSameFile?: boolean | undefined;
  /** When false (default), skip matches where every occurrence's source span is predominantly
   *  inline SVG / SVG-shaped JSX markup. Two mechanisms produce these: the token-shingle block
   *  matcher (under the default `ignoreLiterals: true` the `d=` path string and filter constants
   *  that actually tell two icons apart normalize to a placeholder, so *different* icons
   *  token-match on their shared skeleton), and the `defKind: "jsxElement"` detector (two icons
   *  sharing a byte-identical `<defs>`/`<filter>` block — boilerplate, not an authored clone).
   *  Both are excluded here. Set true to see them anyway; they're always tagged
   *  `signals: ["svg-markup"]` regardless. Mirrors `includeSameFile`'s default-off/opt-in shape.
   *  See `svg-markup.ts`. */
  includeSvgMarkup?: boolean | undefined;
  /** Which duplicates to surface, by whether test files are involved (default `"src"`). A group
   *  with any occurrence in a test file (`__tests__/`, `__mocks__/`, `*.test.*`, `*.spec.*`,
   *  `__snapshots__/`) is always tagged `signals: ["test"]`; this option decides which of those
   *  reach `groups`/`clusters`:
   *  - `"src"` (default) — drop every cluster that has a test-file occurrence. Auditing product
   *    code shouldn't be buried under `render(<Icon/>); expect(…).toMatchSnapshot()` repeated
   *    across hundreds of icon tests.
   *  - `"tests"` — surface *only* test clusters, and only the substantive ones: a cluster with
   *    ≥ {@link TEST_SUBSTANTIVE_BLOCKS} distinct shared blocks across ≤ {@link
   *    TEST_SUBSTANTIVE_MAX_FILES} files, or one block ≥ {@link TEST_SUBSTANTIVE_TOKENS} tokens —
   *    i.e. shared setup / mocks / assertions worth a helper, not a one-block render skeleton.
   *  - `"all"` — every cluster, test or not, subject only to the other filters. */
  scope?: "src" | "tests" | "all" | undefined;
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
  /** `groups` (before `limit` truncation) bucketed by *exact* occurrence file set — every group
   *  is merged into one cluster with every other group whose occurrences touch the identical set
   *  of files, so N separate non-nested matches between the same two files (the "window-splitting"
   *  case, see docs/known_issues/09-duplicate-clone-family-noise.md) read as one `matchCount: N`
   *  entry instead of N rows a caller has to manually recognize as the same underlying
   *  duplication. Deliberately *not* transitive across partially-overlapping file sets (a group
   *  over `{A, B}` and one over `{B, C}` land in separate clusters) — an earlier connected-
   *  component version was chaining unrelated files through shared bridge files into one
   *  incomprehensible supercluster on real repos; see `src/graph/duplication/clusters.ts`'s
   *  top-of-file comment. Largest-`longestMatch`-first, capped at `limit` clusters (each cluster's
   *  own `groups` are never truncated). No group is dropped or altered to build this — every group
   *  in `groups` (subject to `limit`) also appears inside exactly one cluster here. Each cluster
   *  also carries per-file duplication `coverage` — merged occurrence spans divided by that
   *  file's total line count — so `matchCount: 14` reads as "62% of this file" rather than just
   *  a row count; see `src/graph/duplication/clusters.ts`'s `DuplicateClusterFileCoverage`. */
  clusters: DuplicateCluster[];
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
 *   because `includeGenerated: true`, `"svg-markup"` when every occurrence's source span reads as
 *   inline SVG / SVG-shaped JSX markup (see {@link isSvgMarkupSpan}), `"test"` when any occurrence
 *   is in a test file (see {@link TEST_PATH}). Merged with any signal the
 *   group's own extractor already set (e.g. `style-vars.ts`'s `"value-drift"`) rather than
 *   replacing it.
 *
 *   `"svg-markup"` is applied to `kind: "definition"` groups (a `defKind: "jsxElement"` match on
 *   an icon's shared `<defs>`/`<filter>` block) as well as block matches: both are noise the user
 *   asked to have out of the default view. It stays recoverable via `includeSvgMarkup` — the
 *   `jsxElement` detector still produces the group, it's just filtered by default like `same-file`.
 * @param group - A finalized duplicate group.
 * @param generatedPaths - Project-relative paths of generated files kept in this scan.
 * @param sourceByFile - Retained source text per file (JS/TS files only — the ones inline SVG
 *   lives in), used for the `"svg-markup"` check; a group with an occurrence whose source isn't
 *   available is simply never tagged `"svg-markup"`.
 * @returns The same group with `signals` set when at least one applies, otherwise unchanged.
 */
function withSignals(
  group: DuplicateGroup,
  generatedPaths: ReadonlySet<string>,
  sourceByFile: ReadonlyMap<string, string>,
): DuplicateGroup {
  const signals: DuplicateSignal[] = [...(group.signals ?? [])];
  if (new Set(group.occurrences.map((occ) => occ.file)).size === 1) signals.push("same-file");
  if (group.occurrences.some((occ) => generatedPaths.has(occ.file))) signals.push("generated");
  if (group.occurrences.some((occ) => TEST_PATH.test(occ.file))) signals.push("test");
  if (
    group.occurrences.length > 0 &&
    group.occurrences.every((occ) => {
      const source = sourceByFile.get(occ.file);
      return source !== undefined && isSvgMarkupSpan(source, occ.startLine, occ.endLine);
    })
  ) {
    signals.push("svg-markup");
  }
  return signals.length > 0 ? { ...group, signals } : group;
}

/**
 * @description Whether a cluster's shared test code is substantial enough to be worth surfacing
 *   under `scope: "tests"` — several distinct shared blocks between a small set of files (shared
 *   setup, mocks and assertions copied between two real test suites), or one large shared block.
 *   A cluster that's just one small block repeated across many files is the
 *   `render(<X/>); expect(…).toMatchSnapshot()` skeleton and stays hidden.
 * @param cluster - A built {@link DuplicateCluster}.
 * @returns `true` when the cluster clears one of the substantive-test bars.
 */
function isSubstantiveTestCluster(cluster: DuplicateCluster): boolean {
  const maxTokens = Math.max(0, ...cluster.groups.map((group) => group.tokens));
  if (maxTokens >= TEST_SUBSTANTIVE_TOKENS) return true;
  return (
    cluster.groups.length >= TEST_SUBSTANTIVE_BLOCKS &&
    cluster.files.length <= TEST_SUBSTANTIVE_MAX_FILES
  );
}

/**
 * @description Applies the `scope` option to one cluster. A cluster "involves tests" when any of
 *   its groups carries the `"test"` signal (every group in a cluster shares the same file set, so
 *   this is all-or-nothing per cluster).
 * @param cluster - A built {@link DuplicateCluster}.
 * @param scope - `"src"` drops test clusters, `"tests"` keeps only substantive ones, `"all"`
 *   keeps every cluster.
 * @returns `true` if the cluster should appear in the result under `scope`.
 */
function clusterInScope(
  cluster: DuplicateCluster,
  scope: NonNullable<FindDuplicatesOptions["scope"]>,
): boolean {
  if (scope === "all") return true;
  const involvesTests = cluster.groups.some((group) => group.signals?.includes("test"));
  return scope === "tests" ? involvesTests && isSubstantiveTestCluster(cluster) : !involvesTests;
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
 *   ({@link getDuplicateFamily} — `"js"` for JS/TS/Coffee/LS, `"jvm"` for Java/Kotlin/Scala/
 *   Groovy, `"style"` for Stylus, and one family each for Python, Go, Lua, Markdown, Gherkin) so
 *   matching never crosses a family boundary — a `for` loop tokenizes almost identically in Java,
 *   Go and TS, so a single `"code"` family produced phantom cross-language matches on polyglot
 *   repos. See docs/adr-013-duplicate-detection-noise-reduction.md.
 * @param graph - The graph to scan; its node paths (already ignore-rule-filtered) are the file
 *   list, re-read from disk since duplication data isn't cached on `FileNode`.
 * @param rootDir - Absolute project root that graph paths are relative to.
 * @param options - `minLines`/`windowSize` tune token-shingle sensitivity (`minLines` also caps
 *   CSS/Less/SCSS block size); `ignoreLiterals` toggles Type-2 vs Type-1 matching for the
 *   token-shingle path only (CSS/Less/SCSS always match on literal declaration content);
 *   `maxPunctuationRatio` gates out token-shingle blocks that are mostly object/array-literal
 *   structural punctuation (e.g. schema/object-literal boilerplate) rather than substantive
 *   shared logic; `ignoreDirs` excludes files under matching directory names; `includeSameFile`
 *   controls whether same-file-only matches are returned (excluded by default — see its doc
 *   comment); `includeSvgMarkup` likewise controls whether inline-SVG-markup matches are returned
 *   (excluded by default — two different icons share a literal-normalized skeleton); `scope`
 *   filters whole clusters by test-file involvement — `"src"` (default) drops every test cluster,
 *   `"tests"` returns only the substantive ones, `"all"` returns everything; `limit` caps
 *   results; `parallelTokenizing` offloads per-file tokenizing to a worker
 *   pool once the candidate file count is large enough to be worth it. Lock files and
 *   `type: "unknown"` nodes (non-code assets like `.svg`/`.json` pulled in via an explicit
 *   `import`) are always excluded, independent of `ignoreDirs`.
 * @returns `groups` — duplicate blocks (each tagged with its `family`), two or more occurrences
 *   per block, every block that pairwise chain-matches another clustered into one group instead
 *   of one per pair, sorted largest-first across all families (same-file-only and svg-markup
 *   matches excluded unless `includeSameFile` / `includeSvgMarkup`; test matches filtered per
 *   `scope`). `clusters` — the same groups
 *   bucketed by exact file set, with
 *   per-file duplication coverage, see {@link FindDuplicatesResult.clusters}.
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
    includeSameFile = false,
    includeSvgMarkup = false,
    scope = "src",
    ignoreGlobs = [],
    parallelTokenizing = true,
    tokenCache,
  } = options;

  const nodes = [...graph.nodes.values()].filter(
    (node) =>
      node.type !== "unknown" &&
      !isLockFile(node.path) &&
      !isUnderIgnoredDir(node.path, ignoreDirs),
  );

  // Paths kept in the scan only because `includeGenerated: true` — used to tag matches
  // `signals: ["generated"]`. Empty when `includeGenerated` is false (they're dropped instead).
  const generatedPaths = new Set<string>();

  // Total line count per scanned file, collected as a side effect of reading each file — powers
  // clusters' per-file coverage % (see clusters.ts). Exact when the file was freshly read this
  // scan; falls back to the last token's line number on a token-cache hit, where no source is
  // read at all — a slight undercount if the file ends in blank lines, acceptable for a coverage
  // estimate.
  const fileLineCounts = new Map<string, number>();

  const pool = createTokenizingPool(parallelTokenizing, nodes.length);
  try {
    const structuralStyleFiles: StyleSourceFile[] = [];
    // Shared input for both TS-only interface/type extraction and JS+TS object-literal
    // extraction below — the name reflects the broader (TS ∪ JS) population now, not just the
    // interface/type extractor that originally motivated it.
    const jsLikeFiles: TypeScriptSourceFile[] = [];
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
          fileLineCounts.set(node.path, source.split("\n").length);
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
        // Only populated on the non-cache-hit path below; on a cache hit and `node.type ===
        // "typescript"`, type-def extraction (unlike tokenizing) still needs the source, so it's
        // read again separately just below — an accepted extra read on the minority (repeated
        // same-session call) path, since type-def results aren't cached the way tokens are.
        let sourceForTypeDefs: string | undefined;
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
          sourceForTypeDefs = source;
        }

        if (generated && !includeGenerated) return;
        if (generated) generatedPaths.add(node.path);

        fileLineCounts.set(
          node.path,
          sourceForTypeDefs !== undefined
            ? sourceForTypeDefs.split("\n").length
            : (tokens.at(-1)?.line ?? 0),
        );

        // TS-only for interface/type extraction below, but object-literal extraction
        // (findObjectLiteralDuplicates) runs on both — const object literals are equally common
        // in plain JS, unlike interface/type declarations which are TS-only syntax.
        if (node.type === "typescript" || node.type === "javascript") {
          if (sourceForTypeDefs === undefined) {
            try {
              sourceForTypeDefs = await readFile(path.join(rootDir, node.path), "utf8");
            } catch {
              sourceForTypeDefs = undefined;
            }
          }
          if (sourceForTypeDefs !== undefined) {
            jsLikeFiles.push({ file: node.path, source: sourceForTypeDefs });
          }
        }

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

    // Source text kept only for JS/TS files — the ones inline SVG markup can appear in — so
    // `withSignals` can tag `"svg-markup"` groups off the real source. `jsLikeFiles` is already
    // populated for every JS/TS file this scan saw (even on a token-cache hit, see above), so
    // this needs no extra reads.
    const sourceByFile = new Map(jsLikeFiles.map((file) => [file.file, file.source]));

    const groups: DuplicateGroup[] = findStyleBlockDuplicates(structuralStyleFiles, minLines).map(
      (group) => withSignals(group, generatedPaths, sourceByFile),
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
        groups.push(withSignals({ ...group, family }, generatedPaths, sourceByFile));
      }
    }

    // Declaration-level matching, independent of the block strategies above — see
    // docs/adr-018-per-language-definition-duplicates.md.
    for (const group of findStyleVarDuplicates(structuralStyleFiles)) {
      groups.push(withSignals({ ...group, family: "style" }, generatedPaths, sourceByFile));
    }
    for (const group of findTypeDefDuplicates(jsLikeFiles)) {
      groups.push(withSignals({ ...group, family: "js" }, generatedPaths, sourceByFile));
    }
    for (const group of findObjectLiteralDuplicates(jsLikeFiles)) {
      groups.push(withSignals({ ...group, family: "js" }, generatedPaths, sourceByFile));
    }
    for (const group of findJsxElementDuplicates(jsLikeFiles)) {
      groups.push(withSignals({ ...group, family: "js" }, generatedPaths, sourceByFile));
    }

    // Same-file and svg-markup matches are always computed and tagged above — excluded here, by
    // default, the same way generated files are: a file's own naturally repetitive shape and
    // two-different-icons-share-a-skeleton, respectively, rather than actionable copy-paste.
    // Recoverable via includeSameFile / includeSvgMarkup. See their doc comments.
    const visibleGroups = groups.filter((group) => {
      if (!includeSameFile && group.signals?.includes("same-file")) return false;
      if (!includeSvgMarkup && group.signals?.includes("svg-markup")) return false;
      return true;
    });

    // Cluster from the full pre-limit set so a cluster's matchCount/files aren't shrunk by a cap
    // meant for the flat groups list — see FindDuplicatesResult.clusters' doc comment.
    const allClusters = buildDuplicateClusters(visibleGroups, fileLineCounts);

    // `scope` filters whole clusters by test-file involvement (see the option's doc): "src" drops
    // every test cluster, "tests" keeps only the substantive ones, "all" keeps everything.
    // Applied post-clustering because "substantive" is a cluster-level judgement (distinct-block
    // count, file count). `groups` is then narrowed to the surviving clusters' members so the two
    // outputs stay consistent — every visible group lands in exactly one cluster (see
    // clusters.ts), so identity-set membership is exact.
    const scopedClusters = allClusters.filter((cluster) => clusterInScope(cluster, scope));
    const survivingGroups = new Set(scopedClusters.flatMap((cluster) => cluster.groups));

    return {
      groups: visibleGroups
        .filter((group) => survivingGroups.has(group))
        .sort((a, b) => b.lines - a.lines)
        .slice(0, limit),
      clusters: scopedClusters.slice(0, limit),
    };
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
