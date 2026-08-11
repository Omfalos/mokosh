/**
 * Language-family partitioning for duplicate detection. `findDuplicates` never compares files
 * across a family boundary — see docs/adr-013-duplicate-detection-noise-reduction.md. The
 * immediate driver is CSS-family declarations: they share a small, finite vocabulary (property
 * names, common value keywords) that the shared `KEYWORDS` denylist in `tokenizer.ts` doesn't
 * cover, so unrelated style rules with the same declaration *shape* but different selectors/
 * properties/values were hashing identically to unrelated TS/JS/Python shapes too. Splitting by
 * family also lets later phases tune `windowSize`/`minLines`/vocabulary per family without one
 * family's tuning affecting another's.
 */
import type { FileType } from "../../types/parse";

/** One partition of `findDuplicates` matching — files in different families are never compared. */
export type DuplicateFamily = "style" | "code";

/** CSS-family languages: small, finite declaration vocabulary compared to code identifiers. */
const STYLE_FILE_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  "css",
  "scss",
  "less",
  "stylus",
]);

/**
 * @description Maps a `FileType` to the duplicate-detection family it belongs to. Everything
 *   outside the CSS family (TS/JS, Python, Go, CoffeeScript, LiveScript, Lua, Gherkin, Markdown,
 *   …) falls into the single `"code"` family — the shared `KEYWORDS` denylist in `tokenizer.ts`
 *   is already oriented toward that group, so they can keep matching against each other as
 *   `findDuplicates` does today.
 * @param fileType - The file's parsed language.
 * @returns The family `fileType` belongs to.
 */
export function getDuplicateFamily(fileType: FileType): DuplicateFamily {
  return STYLE_FILE_TYPES.has(fileType) ? "style" : "code";
}
