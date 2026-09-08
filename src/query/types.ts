/**
 * Criteria for filtering nodes in a serialized graph.
 *
 * String fields support a `"!"` prefix for negation (e.g. `category: "!test"`).
 * `tags` uses OR logic across positive entries; negated entries (`"!auth"`) act
 * as mandatory exclusions and are evaluated independently.
 */
export interface NodeQuery {
  category?: string;
  type?: string;
  /** OR match across entries. Prefix with `"!"` to exclude that tag. */
  tags?: string[];
  /** AND match — all entries must be present (use `tag:a+b` syntax in query strings). */
  allTags?: string[];
  path?: string;
  /** Exact match on the node's owning workspace package name. Prefix with `"!"` to negate.
   *  Only meaningful when a `packageOf` lookup is supplied to `filterGraph`/`matchNode`
   *  (i.e. querying a flattened workspace graph); ignored otherwise. */
  package?: string;
  isExternal?: boolean;
  /** Substring match on `imp.toPath` — node must import a file whose path contains this string. */
  importsFile?: string;
  /** Substring match on importer paths — node must be imported by a file whose path contains this string. */
  importedBy?: string;
  minImports?: number;
  maxImports?: number;
  minSize?: number;
  maxSize?: number;
  sort?:
    | "size"
    | "imports"
    | "commitCount90d"
    | "exportUsage"
    | "complexity"
    | "cognitiveComplexity";
  /** Sort direction for `sort`. Defaults to `"desc"`, matching the pre-existing always-descending behavior. */
  sortDir?: "asc" | "desc";
  limit?: number;
  hasDocstring?: boolean;
  /** Minimum line-coverage percentage; nodes below this value are excluded. Nodes with no coverage data are excluded. */
  minCoverage?: number;
  /** Maximum line-coverage percentage; nodes above this value are excluded. Nodes with no coverage data are treated as 0%. */
  maxCoverage?: number;
  /** Minimum avgExportUsage (0–1); nodes below this value are excluded. Nodes with no data are excluded. */
  minExportUsage?: number;
  /** Maximum avgExportUsage (0–1); nodes above this value are excluded. Nodes with no data are treated as 0. */
  maxExportUsage?: number;
  /** Minimum McCabe cyclomatic complexity. Nodes with no complexity data (non-TS/JS files) are excluded. */
  minComplexity?: number;
  /** Maximum McCabe cyclomatic complexity. Nodes with no complexity data are treated as 0. */
  maxComplexity?: number;
  /** Minimum cognitive complexity. Nodes with no complexity data (non-TS/JS files) are excluded. */
  minCognitiveComplexity?: number;
  /** Maximum cognitive complexity. Nodes with no complexity data are treated as 0. */
  maxCognitiveComplexity?: number;
  /** Minimum commitCount90d. Nodes with no git-stats data are excluded. */
  minCommits?: number;
  /** Maximum commitCount90d. Nodes with no git-stats data are treated as 0. */
  maxCommits?: number;
  /** true = node has at least one markdown doc referencing it (documentedBy non-empty); false = undocumented nodes only. */
  isDocumented?: boolean;
  /** true = node is flagged as doc-stale (staleFor non-empty); false = non-stale nodes only. */
  isStale?: boolean;
  /** Exact match on FileNode.lastAuthor. Prefix with "!" to negate. Nodes with no author data fail the positive form and pass the negative form. */
  lastAuthor?: string;
  /** OR-group: node matches if it satisfies ANY sub-query in this array, ANDed with all other top-level fields on this NodeQuery. Populated by `any(key:val|key:val)` syntax in query strings. */
  any?: NodeQuery[];
}

/** Sortable axes for `find_duplicates` results (`DuplicateQuery.sort`). */
export type DupSortField = "lines" | "score" | "occurrences";

/**
 * Criteria for filtering `find_duplicates` results — the duplicate-group/cluster analogue of
 * {@link NodeQuery}. Parsed from a `"key:value,key:value"` string by `parseDupQuery`
 * (AND across keys); applied per group by `matchDupGroup`. String fields support a `"!"` prefix
 * for negation. A group's occurrences never span more than one language family or `FileType`
 * (matching never crosses a family boundary), so `family`/`type` are effectively group-level.
 */
export interface DuplicateQuery {
  /** Substring match on occurrence paths — matches when *at least one* occurrence's path
   *  contains this. `"!substr"` matches when *no* occurrence's path contains it. */
  path?: string;
  /** Substring match — matches only when *every* occurrence's path contains this (an
   *  entirely-within-one-module duplicate). `"!substr"` negates (no occurrence contains it). */
  allPaths?: string;
  /** Exact match on the group's `family` (`js`, `jvm`, `style`, `python`, `go`, `lua`,
   *  `markdown`, `gherkin`, `other`). `"!"` to negate. */
  family?: string;
  /** Exact match on the `FileType` shared by every occurrence (derived from each occurrence's
   *  path). `"!lang"` matches when no occurrence is of that type. */
  type?: string;
  /** `"block"` (a span match) or `"definition"` (a declaration-level match). */
  kind?: string;
  /** Exact match on a definition group's `defKind` (`cssVar` | `interface` | `type` |
   *  `objectLiteral` | `jsxElement`). `"!"` to negate. */
  defKind?: string;
  /** Minimum / maximum duplicated block size in lines (`DuplicateGroup.lines`). */
  minLines?: number;
  maxLines?: number;
  /** Minimum / maximum logic-token score (`DuplicateGroup.score`, falling back to `lines` for
   *  definition groups, which carry no score). */
  minScore?: number;
  maxScore?: number;
  /** Minimum number of occurrences (`DuplicateGroup.occurrences.length`). */
  minOccurrences?: number;
  /** `true` = occurrences span ≥2 distinct files; `false` = every occurrence is in one file. */
  crossFile?: boolean;
  /** OR match across positive entries (`DuplicateSignal` names); `"!name"` entries are
   *  mandatory exclusions, evaluated independently. */
  signals?: string[];
  /** Result ordering for the flat `groups` list. */
  sort?: DupSortField;
  /** Direction for `sort`. Defaults to `"desc"`. */
  sortDir?: "asc" | "desc";
  /** Cap on the number of results. */
  limit?: number;
}
