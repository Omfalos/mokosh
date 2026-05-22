import type { NodeQuery } from "./types";

/**
 * Parses a query string into a {@link NodeQuery} object.
 *
 * Format: `"key1:value1,key2:value2"`
 *
 * Supported keys: `category`, `type`, `tag` / `tags`, `path`, `external`,
 * `importsFile`, `importedBy`, `minImports`, `maxImports`, `minSize`, `maxSize`,
 * `sort`, `limit`, `hasDocstring`, `minCoverage`, `maxCoverage`, `minExportUsage`, `maxExportUsage`
 *
 * String values support a `"!"` prefix for negation (e.g. `"category:!test"`).
 * The `tag`/`tags` key may appear multiple times; all values are collected and
 * matched with OR logic (negated entries act as exclusions).
 *
 * @param queryString - Comma-separated key:value pairs.
 * @returns A structured {@link NodeQuery} object.
 *
 * @example
 * parseQuery("category:logic,tag:auth,tag:payments")
 * // → { category: "logic", tags: ["auth", "payments"] }
 *
 * @example
 * parseQuery("category:!test,tag:auth")
 * // → { category: "!test", tags: ["auth"] }
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
