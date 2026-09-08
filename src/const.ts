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

/** Legacy filename for the single-blob disk-persisted *workspace* (monorepo) graph cache within
 *  `DEFAULT_CACHE_DIR`. Superseded by `DEFAULT_WORKSPACE_CACHE_SUBDIR` (a manifest plus one file
 *  per package) — retained only so `src/graph/workspace/disk-cache.ts` can unlink a stale copy
 *  left by an older mokosh. A 190 MB+ single file here was `JSON.parse`d whole and OOM-killed the
 *  MCP server; see the manifest layout below. */
export const DEFAULT_WORKSPACE_GRAPH_CACHE_FILE = "workspace-graph.json";

/** Subdirectory of `DEFAULT_CACHE_DIR` holding the workspace graph cache as a `manifest.json`
 *  ("the map file") plus one `<pkg-slug>.json` per package. Each package file is parsed on its
 *  own, so peak memory on hydrate is bounded by the largest single package rather than the whole
 *  serialized workspace. Written/read by `src/graph/workspace/disk-cache.ts`, driven from
 *  `src/mcp/cache.ts`. */
export const DEFAULT_WORKSPACE_CACHE_SUBDIR = "workspace";

/** Filename of the workspace cache manifest within `DEFAULT_WORKSPACE_CACHE_SUBDIR`: the small
 *  index that carries the layout, the root (non-package-owned) source digest, and one entry per
 *  package (name, relative root, entry points, per-package digest, node count, cache filename). */
export const WORKSPACE_MANIFEST_FILE = "manifest.json";

/** Schema version stamped into the workspace cache manifest. A mismatch on read discards the
 *  whole cache (full rebuild) — bump this whenever the serialized `FileNode` shape or the
 *  manifest structure changes incompatibly. */
export const WORKSPACE_CACHE_VERSION = 1;

/** A single package whose serialized node array exceeds this is not written to the workspace
 *  cache (and never read back) — that package always rebuilds. Keeps any one per-package
 *  `JSON.parse` on hydrate within a safe memory envelope. */
export const MAX_PACKAGE_CACHE_BYTES = 48 * 1024 * 1024;

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
  ".pytest_cache",
  "__pycache__",
  ".gradle",
  "target",
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
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".sc",
  ".groovy",
  ".gradle",
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
