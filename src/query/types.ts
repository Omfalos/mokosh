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
  path?: string;
  isExternal?: boolean;
}
