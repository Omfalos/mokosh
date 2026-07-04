/** Tag applier strategy interface — one implementation per testing framework. */

export type TagFramework = "vitest" | "playwright" | "cypress" | "jest";

/**
 * @description A strategy that knows how to inject or remove tag metadata in a specific
 *   test-framework format. The applier calls `canHandle` to select the right strategy per file,
 *   then calls `apply` to get the updated source. File I/O and dry-run logic live in the caller.
 */
export interface TagApplierStrategy {
  /** Display name used in logs and errors. */
  readonly name: string;

  /**
   * @description Returns true when this strategy is capable of annotating the given file.
   * @param {string} absPath - Absolute file path to evaluate.
   * @returns {boolean} True when this strategy should handle the file.
   */
  canHandle(absPath: string): boolean;

  /**
   * @description Applies (or removes) tags in the file source. Returns the new source
   *   string after modification. The caller writes the file only when the returned value
   *   differs from the original source.
   * @param {string} absPath - Absolute file path (used for format hints, not I/O).
   * @param {string} source - Current file contents.
   * @param {string[]} tags - Sorted, unique tag names to write. An empty array removes
   *   previously injected tags.
   * @returns {string} Potentially modified source (may equal `source` when no change is needed).
   */
  apply(absPath: string, source: string, tags: string[]): string;
}
