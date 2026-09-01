/** Parses a key:value query string into a structured NodeQuery for use with filterGraph. */
import type { NodeQuery } from "./types";

/** A clause value's parsing/coercion rule, keyed by the field it lands on in `NodeQuery`. */
type ClauseValueKind = "string" | "int" | "float" | "boolNotFalse" | "boolIsTrue";

/**
 * @description Table of `key:value` clauses that reduce to "coerce `value` and assign it to one
 *   `NodeQuery` field" — every key except the multi-value/special-cased ones (`tag`/`tags`,
 *   `sort`, `sortdir`) handled directly in {@link applyClause}. Adding a new scalar filter key
 *   only requires a new table row here, not a new branch.
 * @type {Record<string, { field: keyof NodeQuery; kind: ClauseValueKind }>}
 */
const SIMPLE_CLAUSE_HANDLERS: Record<string, { field: keyof NodeQuery; kind: ClauseValueKind }> = {
  category: { field: "category", kind: "string" },
  type: { field: "type", kind: "string" },
  path: { field: "path", kind: "string" },
  importsfile: { field: "importsFile", kind: "string" },
  importedby: { field: "importedBy", kind: "string" },
  lastauthor: { field: "lastAuthor", kind: "string" },
  external: { field: "isExternal", kind: "boolIsTrue" },
  hasdocstring: { field: "hasDocstring", kind: "boolNotFalse" },
  isdocumented: { field: "isDocumented", kind: "boolNotFalse" },
  isstale: { field: "isStale", kind: "boolNotFalse" },
  minimports: { field: "minImports", kind: "int" },
  maximports: { field: "maxImports", kind: "int" },
  minsize: { field: "minSize", kind: "int" },
  maxsize: { field: "maxSize", kind: "int" },
  limit: { field: "limit", kind: "int" },
  mincoverage: { field: "minCoverage", kind: "int" },
  maxcoverage: { field: "maxCoverage", kind: "int" },
  minexportusage: { field: "minExportUsage", kind: "float" },
  maxexportusage: { field: "maxExportUsage", kind: "float" },
  mincomplexity: { field: "minComplexity", kind: "int" },
  maxcomplexity: { field: "maxComplexity", kind: "int" },
  mincognitivecomplexity: { field: "minCognitiveComplexity", kind: "int" },
  maxcognitivecomplexity: { field: "maxCognitiveComplexity", kind: "int" },
  mincommits: { field: "minCommits", kind: "int" },
  maxcommits: { field: "maxCommits", kind: "int" },
};

/**
 * @description Coerces a raw clause value string per `kind` and assigns it onto `query[field]`.
 * @param {NodeQuery} query - The query object to mutate.
 * @param {keyof NodeQuery} field - Which field on `query` to set.
 * @param {ClauseValueKind} kind - How to parse `value` before assigning.
 * @param {string} value - The raw (already trimmed, non-empty) clause value.
 * @returns {void}
 */
function assignSimpleClause(
  query: NodeQuery,
  field: keyof NodeQuery,
  kind: ClauseValueKind,
  value: string,
): void {
  const target = query as Record<string, unknown>;
  switch (kind) {
    case "string":
      target[field] = value;
      break;
    case "int":
      target[field] = parseInt(value, 10);
      break;
    case "float":
      target[field] = parseFloat(value);
      break;
    case "boolNotFalse":
      target[field] = value.toLowerCase() !== "false";
      break;
    case "boolIsTrue":
      target[field] = value.toLowerCase() === "true";
      break;
  }
}

/**
 * @description Parses and applies a single `key:value` clause onto `query`, mutating it in
 *   place. Shared by the top-level comma-split loop and by each `|`-separated clause inside an
 *   `any(...)` OR-group, so both contexts recognize exactly the same set of keys. Most keys are
 *   handled generically via {@link SIMPLE_CLAUSE_HANDLERS}; `tag`/`tags`, `sort`, and `sortdir`
 *   need bespoke multi-value or literal-union handling and stay inline.
 * @param {NodeQuery} query - The query object to mutate with this clause's parsed value.
 * @param {string} part - A single `key:value` clause (no surrounding commas).
 * @returns {void}
 */
function applyClause(query: NodeQuery, part: string): void {
  const colonIdx = part.indexOf(":");
  if (colonIdx === -1) return;
  const key = part.slice(0, colonIdx).trim().toLowerCase();
  const value = part.slice(colonIdx + 1).trim();
  if (!key || !value) return;

  if (key === "tag" || key === "tags") {
    if (value.includes("+")) {
      query.allTags = [...(query.allTags ?? []), ...value.split("+")];
    } else {
      query.tags = [...(query.tags ?? []), value];
    }
    return;
  }
  if (key === "sort") {
    query.sort = value as
      | "size"
      | "imports"
      | "commitCount90d"
      | "exportUsage"
      | "complexity"
      | "cognitiveComplexity";
    return;
  }
  if (key === "sortdir") {
    query.sortDir = value.toLowerCase() === "asc" ? "asc" : "desc";
    return;
  }

  const handler = SIMPLE_CLAUSE_HANDLERS[key];
  if (handler) assignSimpleClause(query, handler.field, handler.kind, value);
}

/**
 * @description Parses an `any(clause|clause|...)` OR-group token into an array of single-clause
 *   sub-queries, each parsed independently via `applyClause`. Each `|`-separated clause is a
 *   single `key:value` pair — multi-key sub-AND clauses inside a group are not supported.
 * @param {string} inner - The group contents, with the `any(`/`)` wrapper already stripped.
 * @returns {NodeQuery[]} One `NodeQuery` per non-empty `|`-separated clause.
 */
function parseAnyGroup(inner: string): NodeQuery[] {
  const subQueries: NodeQuery[] = [];
  for (const clause of inner.split("|")) {
    const trimmedClause = clause.trim();
    if (!trimmedClause) continue;
    const subQuery: NodeQuery = {};
    applyClause(subQuery, trimmedClause);
    if (Object.keys(subQuery).length > 0) subQueries.push(subQuery);
  }
  return subQueries;
}

/**
 * @description Parses a `"key:value,key:value"` query string into a structured `NodeQuery`.
 *   String values support `"!"` prefix for negation. The `tag`/`tags` key may appear multiple
 *   times; values are OR-matched (negated entries act as exclusions). `tag:a+b` maps to `allTags`.
 *   A token of the form `any(key:val|key:val)` is parsed as an OR-group of single-key clauses
 *   and accumulates into `query.any`, ANDed with every other top-level key in the string.
 * @param {string} queryString - Comma-separated `key:value` pairs, e.g. `"category:logic,tag:auth"`.
 * @returns {NodeQuery} The structured query object ready for use with `filterGraph` or `matchNode`.
 */
const ANY_GROUP_PREFIX = "any(";

export function parseQuery(queryString: string): NodeQuery {
  const query: NodeQuery = {};
  const parts = queryString.split(",");

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (trimmedPart.toLowerCase().startsWith(ANY_GROUP_PREFIX) && trimmedPart.endsWith(")")) {
      const inner = trimmedPart.slice(ANY_GROUP_PREFIX.length, -1);
      const subQueries = parseAnyGroup(inner);
      if (subQueries.length > 0) query.any = [...(query.any ?? []), ...subQueries];
      continue;
    }
    applyClause(query, part);
  }

  return query;
}
