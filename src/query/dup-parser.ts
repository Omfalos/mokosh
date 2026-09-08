/** Parses a `key:value` filter string for `find_duplicates` results into a structured DuplicateQuery. */
import type { DuplicateQuery, DupSortField } from "./types";

/** How a clause value is coerced before it lands on its {@link DuplicateQuery} field. */
type DupClauseKind = "string" | "int" | "bool";

/**
 * @description Table of `key:value` clauses that reduce to "coerce `value` and assign it to one
 *   {@link DuplicateQuery} field". Every key except the multi-value / literal-union ones
 *   (`signal`/`signals`, `sort`, `sortdir`) is handled generically from this table, mirroring
 *   `src/query/parser.ts`'s design. Keys are compared lower-cased.
 * @type {Record<string, { field: keyof DuplicateQuery; kind: DupClauseKind }>}
 */
const SIMPLE_DUP_HANDLERS: Record<string, { field: keyof DuplicateQuery; kind: DupClauseKind }> = {
  path: { field: "path", kind: "string" },
  allpaths: { field: "allPaths", kind: "string" },
  family: { field: "family", kind: "string" },
  type: { field: "type", kind: "string" },
  kind: { field: "kind", kind: "string" },
  defkind: { field: "defKind", kind: "string" },
  minlines: { field: "minLines", kind: "int" },
  maxlines: { field: "maxLines", kind: "int" },
  minscore: { field: "minScore", kind: "int" },
  maxscore: { field: "maxScore", kind: "int" },
  minoccurrences: { field: "minOccurrences", kind: "int" },
  crossfile: { field: "crossFile", kind: "bool" },
  limit: { field: "limit", kind: "int" },
};

/** Valid `sort:` values — kept in sync with {@link DuplicateQuery.sort}. */
const DUP_SORT_FIELDS = new Set(["lines", "score", "occurrences"]);

/** Every key the DSL recognizes (table keys plus the special-cased ones). Used to reject typos
 *  loudly rather than silently returning zero matches. */
const KNOWN_DUP_KEYS = new Set([
  ...Object.keys(SIMPLE_DUP_HANDLERS),
  "signal",
  "signals",
  "sort",
  "sortdir",
]);

/**
 * @description Coerces a raw clause value per `kind` and assigns it onto `query[field]`.
 * @param {DuplicateQuery} query - The query object to mutate.
 * @param {keyof DuplicateQuery} field - Which field on `query` to set.
 * @param {DupClauseKind} kind - How to parse `value` before assigning.
 * @param {string} key - The original clause key, for error messages.
 * @param {string} value - The raw (already trimmed, non-empty) clause value.
 * @returns {void}
 * @throws {Error} When a numeric clause value is not a finite number.
 */
function assignDupClause(
  query: DuplicateQuery,
  field: keyof DuplicateQuery,
  kind: DupClauseKind,
  key: string,
  value: string,
): void {
  const target = query as Record<string, unknown>;
  if (kind === "string") {
    target[field] = value;
    return;
  }
  if (kind === "bool") {
    target[field] = value.toLowerCase() === "true";
    return;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`find_duplicates filter: "${key}" expects a number, got "${value}"`);
  }
  target[field] = parsed;
}

/**
 * @description Parses and applies a single `key:value` clause onto `query`, mutating it in place.
 *   Most keys are handled generically via {@link SIMPLE_DUP_HANDLERS}; `signal`/`signals`
 *   accumulate into `query.signals` (repeatable; `"!name"` entries kept verbatim for the
 *   matcher to treat as exclusions), and `sort`/`sortdir` map to literal unions.
 * @param {DuplicateQuery} query - The query object to mutate with this clause's parsed value.
 * @param {string} part - A single `key:value` clause (no surrounding commas).
 * @returns {void}
 * @throws {Error} On an unknown key or an invalid `sort` value.
 */
function applyDupClause(query: DuplicateQuery, part: string): void {
  const colonIdx = part.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`find_duplicates filter: clause "${part}" is not "key:value"`);
  }
  const key = part.slice(0, colonIdx).trim().toLowerCase();
  const value = part.slice(colonIdx + 1).trim();
  if (!key || !value) return;

  if (!KNOWN_DUP_KEYS.has(key)) {
    throw new Error(
      `find_duplicates filter: unknown key "${key}". Known keys: ${[...KNOWN_DUP_KEYS].sort().join(", ")}`,
    );
  }

  if (key === "signal" || key === "signals") {
    query.signals = [...(query.signals ?? []), value];
    return;
  }
  if (key === "sort") {
    if (!DUP_SORT_FIELDS.has(value)) {
      throw new Error(
        `find_duplicates filter: sort must be one of ${[...DUP_SORT_FIELDS].join(", ")}, got "${value}"`,
      );
    }
    query.sort = value as DupSortField;
    return;
  }
  if (key === "sortdir") {
    query.sortDir = value.toLowerCase() === "asc" ? "asc" : "desc";
    return;
  }

  const handler = SIMPLE_DUP_HANDLERS[key];
  if (handler) assignDupClause(query, handler.field, handler.kind, key, value);
}

/**
 * @description Parses a `"key:value,key:value"` filter string (AND across keys) into a
 *   structured {@link DuplicateQuery} for use with `matchDupGroup` / `applyDupQuery`. An empty
 *   or whitespace-only string yields an empty query (matches everything).
 * @param {string} queryString - Comma-separated `key:value` pairs, e.g.
 *   `"crossFile:true,type:typescript,path:!test"`.
 * @returns {DuplicateQuery} The structured query object.
 * @throws {Error} On an unknown key, a malformed clause, a non-numeric numeric value, or an
 *   invalid `sort` value — surfaced to the caller rather than silently ignored, so a typo'd
 *   filter fails loudly instead of returning zero groups.
 */
export function parseDupQuery(queryString: string): DuplicateQuery {
  const query: DuplicateQuery = {};
  for (const part of queryString.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    applyDupClause(query, trimmed);
  }
  return query;
}
