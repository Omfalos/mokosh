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