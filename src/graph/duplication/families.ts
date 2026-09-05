/**
 * Language-family partitioning for duplicate detection. `findDuplicates` never compares files
 * across a family boundary — see docs/adr-013-duplicate-detection-noise-reduction.md.
 *
 * The original driver was CSS: style declarations share a small, finite vocabulary (property
 * names, common value keywords) that the shared `KEYWORDS` denylist in `tokenizer.ts` doesn't
 * cover, so unrelated rules with the same declaration *shape* hashed identically to unrelated
 * code shapes. The same argument applies, more weakly, *within* code: Java, Go, and TS/JS all use
 * C-style `if (…) { … }` / `for (…; …; …)` blocks, so a `for` loop that pushes onto a list
 * tokenizes almost identically in all three once identifiers collapse to `ID` — a polyglot repo
 * then reports phantom control-flow "duplicates" across languages that share nothing. So code is
 * split by paradigm too, not lumped into one family.
 *
 * Grouping (not one family per `FileType`) is deliberate: JavaScript↔TypeScript and
 * CoffeeScript/LiveScript→JavaScript ports are real, common, cross-`FileType` duplication worth
 * detecting, so those languages share the `"js"` family. The JVM languages interoperate and share
 * idioms, so they share `"jvm"` — and, being their own family, never match against `"js"`, which
 * is the case that motivated this split. Splitting by family also lets later phases tune
 * `windowSize`/`minLines`/vocabulary per family without one family's tuning affecting another's.
 */
import type { FileType } from "../../types/parse";

/** One partition of `findDuplicates` matching — files in different families are never compared. */
export type DuplicateFamily =
  | "style"
  | "js"
  | "jvm"
  | "python"
  | "go"
  | "lua"
  | "markdown"
  | "gherkin"
  | "other";

/** `FileType` → family. Any type absent here falls to `"other"` (its own bucket, so an
 *  unclassified file can still only match another unclassified file — `unknown`-typed nodes are
 *  already dropped upstream in `index.ts`, so in practice `"other"` stays empty). */
const FAMILY_BY_TYPE: Partial<Record<FileType, DuplicateFamily>> = {
  // CSS-family: small finite declaration vocabulary. Stylus rides the token pipeline (no shared
  // PostCSS AST) but stays isolated here; css/scss/less use the structural comparator.
  css: "style",
  scss: "style",
  less: "style",
  stylus: "style",
  // JS-family: JS↔TS and Coffee/LS→JS ports are genuine cross-FileType duplication.
  javascript: "js",
  typescript: "js",
  coffeescript: "js",
  livescript: "js",
  // JVM-family: interop + shared idioms; never compared against "js".
  java: "jvm",
  kotlin: "jvm",
  scala: "jvm",
  groovy: "jvm",
  python: "python",
  go: "go",
  lua: "lua",
  markdown: "markdown",
  gherkin: "gherkin",
};

/**
 * @description Maps a `FileType` to the duplicate-detection family it belongs to. Files in
 *   different families are never compared by `findDuplicates`.
 * @param fileType - The file's parsed language.
 * @returns The family `fileType` belongs to; `"other"` for any unmapped type.
 */
export function getDuplicateFamily(fileType: FileType): DuplicateFamily {
  return FAMILY_BY_TYPE[fileType] ?? "other";
}
