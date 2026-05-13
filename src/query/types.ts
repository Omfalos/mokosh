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
  isExternal?: boolean;
  /** Substring match on `imp.toPath` — node must import a file whose path contains this string. */
  importsFile?: string;
  /** Substring match on importer paths — node must be imported by a file whose path contains this string. */
  importedBy?: string;
  minImports?: number;
  maxImports?: number;
  minSize?: number;
  maxSize?: number;
  sort?: "size" | "imports" | "commitCount90d";
  limit?: number;
}
