/** Parses a key:value query string into a structured NodeQuery for use with filterGraph. */
import type { NodeQuery } from "./types";

/**
 * @description Parses and applies a single `key:value` clause onto `query`, mutating it in
 *   place. Shared by the top-level comma-split loop and by each `|`-separated clause inside an
 *   `any(...)` OR-group, so both contexts recognize exactly the same set of keys.
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

  switch (key) {
    case "category":
      query.category = value;
      break;
    case "type":
      query.type = value;
      break;
    case "tag":
    case "tags":
      if (value.includes("+")) {
        query.allTags = [...(query.allTags ?? []), ...value.split("+")];
      } else {
        query.tags = [...(query.tags ?? []), value];
      }
      break;
    case "path":
      query.path = value;
      break;
    case "external":
      query.isExternal = value.toLowerCase() === "true";
      break;
    case "importsfile":
      query.importsFile = value;
      break;
    case "importedby":
      query.importedBy = value;
      break;
    case "minimports":
      query.minImports = parseInt(value, 10);
      break;
    case "maximports":
      query.maxImports = parseInt(value, 10);
      break;
    case "minsize":
      query.minSize = parseInt(value, 10);
      break;
    case "maxsize":
      query.maxSize = parseInt(value, 10);
      break;
    case "sort":
      query.sort = value as
        | "size"
        | "imports"
        | "commitCount90d"
        | "exportUsage"
        | "complexity"
        | "cognitiveComplexity";
      break;
    case "sortdir":
      query.sortDir = value.toLowerCase() === "asc" ? "asc" : "desc";
      break;
    case "limit":
      query.limit = parseInt(value, 10);
      break;
    case "hasdocstring":
      query.hasDocstring = value.toLowerCase() !== "false";
      break;
    case "mincoverage":
      query.minCoverage = parseInt(value, 10);
      break;
    case "maxcoverage":
      query.maxCoverage = parseInt(value, 10);
      break;
    case "minexportusage":
      query.minExportUsage = parseFloat(value);
      break;
    case "maxexportusage":
      query.maxExportUsage = parseFloat(value);
      break;
    case "mincomplexity":
      query.minComplexity = parseInt(value, 10);
      break;
    case "maxcomplexity":
      query.maxComplexity = parseInt(value, 10);
      break;
    case "mincognitivecomplexity":
      query.minCognitiveComplexity = parseInt(value, 10);
      break;
    case "maxcognitivecomplexity":
      query.maxCognitiveComplexity = parseInt(value, 10);
      break;
    case "mincommits":
      query.minCommits = parseInt(value, 10);
      break;
    case "maxcommits":
      query.maxCommits = parseInt(value, 10);
      break;
    case "isdocumented":
      query.isDocumented = value.toLowerCase() !== "false";
      break;
    case "isstale":
      query.isStale = value.toLowerCase() !== "false";
      break;
    case "lastauthor":
      query.lastAuthor = value;
      break;
  }
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
export function parseQuery(queryString: string): NodeQuery {
  const query: NodeQuery = {};
  const parts = queryString.split(",");

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (trimmedPart.toLowerCase().startsWith("any(") && trimmedPart.endsWith(")")) {
      const inner = trimmedPart.slice(4, -1);
      const subQueries = parseAnyGroup(inner);
      if (subQueries.length > 0) query.any = [...(query.any ?? []), ...subQueries];
      continue;
    }
    applyClause(query, part);
  }

  return query;
}
