/** Shared by the CLI's disk graph cache (`src/cli/graph-loader.ts`) and the MCP server's
 *  disk-persisted duplication token cache (`src/graph/duplication/token-cache-store.ts`) so both
 *  consumers agree on where "the cache dir" is — a CLI run and an MCP session against the same
 *  root end up sharing the same on-disk files. */
export const DEFAULT_CACHE_DIR = "mokosh-cache";

/** Filename for the disk-persisted `find_duplicates` token cache within `DEFAULT_CACHE_DIR`. */
export const DEFAULT_DUPLICATION_TOKEN_CACHE_FILE = "duplication-tokens.json";

/** Filename for the disk-persisted graph cache within `DEFAULT_CACHE_DIR`. Written by the CLI
 *  (`src/cli/graph-loader.ts`) after every build; read by the MCP server (`src/mcp/cache.ts`) to
 *  seed a session's first `analyze` call so it reuses unchanged nodes instead of parsing cold. */
export const DEFAULT_GRAPH_CACHE_FILE = "graph.json";

/** Subdirectory of `DEFAULT_CACHE_DIR` holding one JSON file per commit sha — graphs built for
 *  the "other" ref in a `compareBranches` call (`src/graph/branch-graph-cache.ts`). Keyed by sha
 *  rather than branch name so entries are immutable and never need invalidation. */
export const DEFAULT_BRANCH_GRAPH_CACHE_DIR = "branch-graphs";

export const DEFAULT_IGNORE_DIRS: readonly string[] = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "mokosh-cache",
  "coverage",
];

export const DEFAULT_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".coffee",
  ".ls",
  ".lua",
  ".py",
  ".go",
  ".feature",
  ".md",
  ".mdx",
];

export interface ScanOptions {
  /** Replaces the default ignore-dir list. Use `additionalIgnoreDirs` to extend instead. */
  ignoreDirs?: string[];
  /** Replaces the default extension list. Use `additionalExtensions` to extend instead. */
  extensions?: string[];
  /** Merged with `DEFAULT_IGNORE_DIRS` (additive). */
  additionalIgnoreDirs?: string[];
  /** Merged with `DEFAULT_EXTENSIONS` (additive). */
  additionalExtensions?: string[];
}
