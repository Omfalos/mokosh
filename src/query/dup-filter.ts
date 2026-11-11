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

/** One predicate per `DuplicateQuery` key — mirrors `NODE_MATCHERS` in `matchers.ts`. Each returns
 *  `true` when its key is absent from the query or the group satisfies it, so a new filter key is a
 *  new entry here, not another branch in {@link matchDupGroup} (Open/Closed). */
type DupMatcher = (group: DuplicateGroup, query: DuplicateQuery) => boolean;

/** Splits an optional leading `"!"` off a clause value. */
function splitNegation(value: string): { bare: string; negated: boolean } {
  return value.startsWith("!")
    ? { bare: value.slice(1), negated: true }
    : { bare: value, negated: false };
}

const occurrenceFiles = (group: DuplicateGroup): string[] =>
  group.occurrences.map((occ) => occ.file);

const DUP_MATCHERS: readonly DupMatcher[] = [
  // path: at least one occurrence path contains the needle; "!" → none do.
  (group, { path }) => {
    if (path === undefined) return true;
    const { bare, negated } = splitNegation(path);
    const some = occurrenceFiles(group).some((p) => p.includes(bare));
    return negated ? !some : some;
  },
  // allPaths: every occurrence path contains the needle; "!" → negation of that.
  (group, { allPaths }) => {
    if (allPaths === undefined) return true;
    const { bare, negated } = splitNegation(allPaths);
    const files = occurrenceFiles(group);
    const all = files.length > 0 && files.every((p) => p.includes(bare));
    return negated ? !all : all;
  },
  (group, { family }) => family === undefined || matchExact(family, group.family),
  // type: every occurrence is of the FileType; "!" → negation of that.
  (group, { type }) => {
    if (type === undefined) return true;
    const { bare, negated } = splitNegation(type);
    const files = occurrenceFiles(group);
    const everyIsType = files.length > 0 && files.every((p) => getFileType(p) === bare);
    return negated ? !everyIsType : everyIsType;
  },
  (group, { kind }) => kind === undefined || matchExact(kind, group.kind ?? "block"),
  (group, { defKind }) => defKind === undefined || matchExact(defKind, group.defKind),
  (group, { minLines }) => minLines === undefined || group.lines >= minLines,
  (group, { maxLines }) => maxLines === undefined || group.lines <= maxLines,
  (group, { minScore }) => minScore === undefined || scoreOf(group) >= minScore,
  (group, { maxScore }) => maxScore === undefined || scoreOf(group) <= maxScore,
  (group, { minOccurrences }) =>
    minOccurrences === undefined || group.occurrences.length >= minOccurrences,
  (group, { crossFile }) =>
    crossFile === undefined || new Set(occurrenceFiles(group)).size >= 2 === crossFile,
  // signals: OR across positives, "!name" entries are mandatory exclusions.
  (group, { signals }) => {
    if (signals === undefined || signals.length === 0) return true;
    const present = new Set<string>(group.signals ?? []);
    const positives = signals.filter((s) => !s.startsWith("!"));
    const negatives = signals.filter((s) => s.startsWith("!")).map((s) => s.slice(1));
    if (negatives.some((s) => present.has(s))) return false;
    return positives.length === 0 || positives.some((s) => present.has(s));
  },
];

/**
 * @description Whether a single {@link DuplicateGroup} satisfies every clause in `query` (AND
 *   across keys). An empty query matches every group.
 * @param {DuplicateGroup} group - The group to test.
 * @param {DuplicateQuery} query - Parsed filter criteria.
 * @returns {boolean} `true` when the group passes all set criteria.
 */
export function matchDupGroup(group: DuplicateGroup, query: DuplicateQuery): boolean {
  return DUP_MATCHERS.every((matcher) => matcher(group, query));
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
