import type { NodeQuery } from "./types";

/**
 * @description Parses a `"key:value,key:value"` query string into a structured `NodeQuery`.
 *   String values support `"!"` prefix for negation. The `tag`/`tags` key may appear multiple
 *   times; values are OR-matched (negated entries act as exclusions). `tag:a+b` maps to `allTags`.
 * @param {string} queryString - Comma-separated `key:value` pairs, e.g. `"category:logic,tag:auth"`.
 * @returns {NodeQuery} The structured query object ready for use with `filterGraph` or `matchNode`.
 */
export function parseQuery(queryString: string): NodeQuery {
  const query: NodeQuery = {};
  const parts = queryString.split(",");

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx).trim().toLowerCase();
    const value = part.slice(colonIdx + 1).trim();
    if (!key || !value) continue;

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
        query.sort = value as "size" | "imports" | "commitCount90d" | "exportUsage";
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
    }
  }

  return query;
}
