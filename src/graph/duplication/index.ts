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
import { DEFAULT_IGNORE_DIRS } from "../../const";
import { matchDupGroup } from "../../query/dup-filter";
import { parseDupQuery } from "../../query/dup-parser";
import type { DuplicateQuery } from "../../query/types";
import type { Graph } from "../model";
import { buildDuplicateClusters } from "./clusters";
import { collectCorpus, selectCandidateNodes } from "./corpus";
import { clusterInScope } from "./scope";
import type { DuplicateGroup } from "./shingle";
import { withSignals } from "./signals";
import { DUPLICATE_STRATEGIES } from "./strategies";
import { createTokenizingPool } from "./token-pool";
import type { FindDuplicatesOptions, FindDuplicatesResult } from "./types";

export type { DuplicateCluster, DuplicateClusterFileCoverage } from "./clusters";
export type { DuplicateFamily } from "./families";
export { hasGeneratedMarker, isGeneratedPath } from "./generated";
export type {
  CachedDuplicationResult,
  DuplicationResultParams,
} from "./result-cache-store";
export {
  duplicationDigest,
  duplicationResultCacheKey,
  loadDuplicationResult,
  saveDuplicationResult,
} from "./result-cache-store";
export {
  type DuplicatesSummary,
  dedupeGroupsAgainstClusters,
  slimDupCluster,
  slimDupGroup,
  slimOccurrences,
  summarizeDuplicates,
  topDir,
} from "./shape";

export type { DuplicateGroup, DuplicateOccurrence, DuplicateSignal } from "./shingle";
export type { StyleSourceFile } from "./style-blocks";
export type { CachedFileTokens, DuplicationTokenCache } from "./token-cache-store";
export { loadTokenCacheFromDisk, saveTokenCacheToDisk } from "./token-cache-store";
export type { TypeScriptSourceFile } from "./type-defs";
export type {
  FindDuplicatesOptions,
  FindDuplicatesResult,
  ParallelTokenizingOption,
} from "./types";

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
 *   `"tests"` returns only the substantive ones, `"all"` returns everything; `filter` is an
 *   optional `key:value` DSL string (see `DuplicateQuery`) applied as a per-group predicate
 *   before clustering; `limit` caps results; `parallelTokenizing` offloads per-file tokenizing
 *   to a worker pool once the candidate file count is large enough to be worth it. Lock files and
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
    includeDocs = false,
    scope = "src",
    minScore = 0,
    ignoreGlobs = [],
    parallelTokenizing = true,
    tokenCache,
    filter,
  } = options;

  const dupQuery: DuplicateQuery | undefined = filter ? parseDupQuery(filter) : undefined;

  const nodes = selectCandidateNodes(graph, ignoreDirs);
  const pool = createTokenizingPool(parallelTokenizing, nodes.length);
  try {
    const corpus = await collectCorpus(
      nodes,
      rootDir,
      { ignoreLiterals, includeGenerated, ignoreGlobs, tokenCache },
      pool,
    );

    const strategyConfig = { minLines, windowSize, maxPunctuationRatio };
    const groups: DuplicateGroup[] = DUPLICATE_STRATEGIES.flatMap((strategy) =>
      strategy
        .run(corpus, strategyConfig)
        .map((group) => withSignals(group, corpus.generatedPaths, corpus.sourceByFile)),
    );

    // Same-file, svg-markup and docs (markdown-family) matches are always computed and tagged
    // above — excluded here by default, the same way generated files are: a file's own
    // repetitive shape, two icons sharing a skeleton, and mirrored prose docs, respectively —
    // none actionable copy-paste. Recoverable via includeSameFile / includeSvgMarkup /
    // includeDocs. See their doc comments. `minScore` additionally drops block matches with too
    // few logic-bearing tokens (Flow `type Props` blocks, icon-component wrappers) — never
    // applied to `kind: "definition"` groups, which are already content-verified. Default 0 =
    // off; see the option's doc.
    const visibleGroups = groups.filter((group) => {
      if (!includeSameFile && group.signals?.includes("same-file")) return false;
      if (!includeSvgMarkup && group.signals?.includes("svg-markup")) return false;
      if (!includeDocs && group.signals?.includes("docs")) return false;
      if (
        minScore > 0 &&
        (group.kind ?? "block") === "block" &&
        (group.score ?? group.tokens) < minScore
      ) {
        return false;
      }
      // The `filter` DSL predicate (path/family/type/size/score/occurrences/crossFile/signal) —
      // applied here, pre-clustering, so `clusters` below reflect the same narrowed set.
      if (dupQuery && !matchDupGroup(group, dupQuery)) return false;
      return true;
    });

    // Cluster from the full pre-limit set so a cluster's matchCount/files aren't shrunk by a cap
    // meant for the flat groups list — see FindDuplicatesResult.clusters' doc comment.
    const allClusters = buildDuplicateClusters(visibleGroups, corpus.fileLineCounts);

    // `scope` filters whole clusters by test-file involvement (see the option's doc): "src" drops
    // every test cluster, "tests" keeps only the substantive ones, "all" keeps everything.
    // Applied post-clustering because "substantive" is a cluster-level judgement (distinct-block
    // count, file count). `groups` is then narrowed to the surviving clusters' members so the two
    // outputs stay consistent — every visible group lands in exactly one cluster (see
    // clusters.ts), so identity-set membership is exact.
    const scopedClusters = allClusters.filter((cluster) => clusterInScope(cluster, scope));
    const survivingGroups = new Set(scopedClusters.flatMap((cluster) => cluster.groups));

    // Rank by logic-token score, then line span — so a large low-information block (a Markdown
    // copy, a JSX icon wrapper) no longer tops the list over denser real duplication. Applied to
    // both outputs: `groups` by its own score, `clusters` by their highest-scoring member.
    // `kind: "definition"` groups carry no score; rank them by their line span (`tokens` there is
    // a member/field count for `type`/`objectLiteral` but a tree size for `jsxElement`, so it's
    // not a comparable axis). See docs/adr-019-logic-token-scoring.md.
    const groupScore = (group: DuplicateGroup) => group.score ?? group.lines;

    return {
      groups: visibleGroups
        .filter((group) => survivingGroups.has(group))
        .sort((a, b) => groupScore(b) - groupScore(a) || b.lines - a.lines)
        .slice(0, limit),
      clusters: scopedClusters
        .sort(
          (a, b) =>
            Math.max(...b.groups.map(groupScore)) - Math.max(...a.groups.map(groupScore)) ||
            b.longestMatch - a.longestMatch,
        )
        .slice(0, limit),
    };
  } finally {
    if (pool) await pool.destroy();
  }
}
