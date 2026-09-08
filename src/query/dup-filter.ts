/** Applies DuplicateQuery predicates to `find_duplicates` groups: path, family, type, size, score,
 *  occurrence count, cross-file, and signal filters, plus DSL-driven sort/limit. */
import type { DuplicateGroup } from "../graph/duplication/shingle";
import { getFileType } from "../parser/file-type";
import type { DuplicateQuery } from "./types";

/**
 * @description Exact string comparison with an optional leading `"!"` for negation.
 * @param {string} queryValue - The clause value, possibly `"!"`-prefixed.
 * @param {string | undefined} actual - The value on the group; `undefined` fails the positive
 *   form and passes the negated form.
 * @returns {boolean} Whether `actual` satisfies `queryValue`.
 */
function matchExact(queryValue: string, actual: string | undefined): boolean {
  if (queryValue.startsWith("!")) return actual !== queryValue.slice(1);
  return actual === queryValue;
}

/**
 * @description The group's logic-token score, falling back to its line count — `kind:
 *   "definition"` groups carry no `score`, and `findDuplicates` ranks those by `lines` too.
 * @param {DuplicateGroup} group - The group to score.
 * @returns {number} `group.score` when set, otherwise `group.lines`.
 */
function scoreOf(group: DuplicateGroup): number {
  return group.score ?? group.lines;
}

/**
 * @description Whether a single {@link DuplicateGroup} satisfies every clause in `query` (AND
 *   across keys). An empty query matches every group.
 * @param {DuplicateGroup} group - The group to test.
 * @param {DuplicateQuery} query - Parsed filter criteria.
 * @returns {boolean} `true` when the group passes all set criteria.
 */
export function matchDupGroup(group: DuplicateGroup, query: DuplicateQuery): boolean {
  const paths = group.occurrences.map((occ) => occ.file);

  if (query.path !== undefined) {
    const needle = query.path;
    const has = (p: string) => p.includes(needle.startsWith("!") ? needle.slice(1) : needle);
    if (needle.startsWith("!") ? paths.some(has) : !paths.some(has)) return false;
  }

  if (query.allPaths !== undefined) {
    const needle = query.allPaths;
    const bare = needle.startsWith("!") ? needle.slice(1) : needle;
    const all = paths.length > 0 && paths.every((p) => p.includes(bare));
    if (needle.startsWith("!") ? all : !all) return false;
  }

  if (query.family !== undefined && !matchExact(query.family, group.family)) return false;

  if (query.type !== undefined) {
    const bare = query.type.startsWith("!") ? query.type.slice(1) : query.type;
    const everyIsType = paths.length > 0 && paths.every((p) => getFileType(p) === bare);
    if (query.type.startsWith("!") ? everyIsType : !everyIsType) return false;
  }

  if (query.kind !== undefined && !matchExact(query.kind, group.kind ?? "block")) return false;
  if (query.defKind !== undefined && !matchExact(query.defKind, group.defKind)) return false;

  if (query.minLines !== undefined && group.lines < query.minLines) return false;
  if (query.maxLines !== undefined && group.lines > query.maxLines) return false;

  const score = scoreOf(group);
  if (query.minScore !== undefined && score < query.minScore) return false;
  if (query.maxScore !== undefined && score > query.maxScore) return false;

  if (query.minOccurrences !== undefined && group.occurrences.length < query.minOccurrences) {
    return false;
  }

  if (query.crossFile !== undefined) {
    const spansMultiple = new Set(paths).size >= 2;
    if (spansMultiple !== query.crossFile) return false;
  }

  if (query.signals !== undefined && query.signals.length > 0) {
    const present = new Set<string>(group.signals ?? []);
    const positives = query.signals.filter((s) => !s.startsWith("!"));
    const negatives = query.signals.filter((s) => s.startsWith("!")).map((s) => s.slice(1));
    if (negatives.some((s) => present.has(s))) return false;
    if (positives.length > 0 && !positives.some((s) => present.has(s))) return false;
  }

  return true;
}

/**
 * @description Applies the DSL's `sort` / `sortDir` / `limit` to an already-filtered group list.
 *   When no `sort` is given the input order is preserved (callers pass groups already ranked by
 *   `findDuplicates`). Pure — returns a new array. Split from {@link applyDupQuery} so consumers
 *   that received predicate-filtered groups from `findDuplicates` can re-order/cap them without a
 *   redundant second predicate pass.
 * @param {DuplicateGroup[]} groups - Groups to order and cap.
 * @param {DuplicateQuery} query - Parsed criteria; only `sort`/`sortDir`/`limit` are read.
 * @returns {DuplicateGroup[]} The groups, ordered and capped per the query.
 */
export function sortLimitDupGroups(
  groups: DuplicateGroup[],
  query: DuplicateQuery,
): DuplicateGroup[] {
  let result = groups;

  if (query.sort) {
    const dir = query.sortDir === "asc" ? -1 : 1;
    const metric: (g: DuplicateGroup) => number =
      query.sort === "score"
        ? scoreOf
        : query.sort === "occurrences"
          ? (g) => g.occurrences.length
          : (g) => g.lines;
    result = [...result].sort((a, b) => (metric(b) - metric(a)) * dir);
  }

  if (query.limit !== undefined) result = result.slice(0, Math.max(0, query.limit));
  return result;
}

/**
 * @description Filters `groups` by `query`, then orders and caps them via
 *   {@link sortLimitDupGroups}. Pure — returns a new array.
 * @param {DuplicateGroup[]} groups - Groups to filter and shape.
 * @param {DuplicateQuery} query - Parsed filter criteria.
 * @returns {DuplicateGroup[]} The matching groups, ordered and capped per the query.
 */
export function applyDupQuery(groups: DuplicateGroup[], query: DuplicateQuery): DuplicateGroup[] {
  return sortLimitDupGroups(
    groups.filter((group) => matchDupGroup(group, query)),
    query,
  );
}
