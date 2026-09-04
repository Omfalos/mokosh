/**
 * Declaration-level duplicate detection for CSS-family "design tokens" — custom properties
 * (`--x`), SCSS variables (`$x`), and Less variables (`@x`) — independent of the rule-body
 * matching `style-blocks.ts` does. Two findings, both real refactor signals a rule-body
 * comparator can't see:
 *
 * 1. **Consolidation candidate** — the same normalized value declared at ≥2 sites, whether under
 *    the same name or different ones (`--brand: #3b82f6` in one file, `$brand: #3b82f6` in
 *    another — same design token, two names).
 * 2. **Value drift** — the same variable *name* declared with ≥2 different values across files
 *    (`--spacing-md` meaning `8px` in one file and `6px` in another) — usually an accidental
 *    inconsistency, not an intentional override.
 *
 * Reuses `style-blocks.ts`'s dialect-dispatch AST parser (`parseStyleAst`) and value normalizer
 * (`normalizeValue`), so both modules see the same PostCSS tree per file. See
 * docs/adr-018-per-language-definition-duplicates.md.
 */

import type { DuplicateGroup, DuplicateOccurrence } from "./shingle";
import type { StyleSourceFile } from "./style-blocks";
import { normalizeValue, parseStyleAst } from "./style-blocks";

interface VarDecl {
  file: string;
  line: number;
  name: string;
  value: string;
}

/**
 * @description Extracts every custom property (`--x`), SCSS variable (`$x`), and Less variable
 *   (`@x`) declaration from one style file, at any nesting depth — deliberately not limited to
 *   root-level declarations the way `scss.ts`/`css.ts`'s *export* extraction is, since a
 *   duplicated token is just as real inside a nested rule or `@media` block.
 * @param file - The style file to scan.
 * @returns One {@link VarDecl} per variable declaration found.
 */
function collectVarDecls(file: StyleSourceFile): VarDecl[] {
  const root = parseStyleAst(file);
  if (!root) return [];

  const decls: VarDecl[] = [];

  // CSS custom properties (all dialects) and SCSS `$variable` declarations both parse as
  // ordinary `decl` nodes — see scss.ts:70 for the same `$`-prefix signal used for exports.
  root.walkDecls((decl) => {
    const isCustomProp = decl.prop.startsWith("--");
    const isScssVar = file.fileType === "scss" && decl.prop.startsWith("$");
    if (!isCustomProp && !isScssVar) return;
    const line = decl.source?.start?.line;
    if (line === undefined) return;
    decls.push({ file: file.file, line, name: decl.prop, value: normalizeValue(decl.value) });
  });

  // Less variables (`@x: value;`) parse as `atrule` nodes carrying a non-standard `value` field
  // — the same signal `css.ts`'s `extractLessVariableExports` uses, walked at any depth here.
  if (file.fileType === "less") {
    root.walkAtRules((atrule) => {
      const { value } = atrule as unknown as { value?: string };
      if (value === undefined) return;
      const line = atrule.source?.start?.line;
      if (line === undefined) return;
      decls.push({ file: file.file, line, name: `@${atrule.name}`, value: normalizeValue(value) });
    });
  }

  return decls;
}

/**
 * @description Finds duplicated CSS/SCSS/Less design tokens across files: variables sharing the
 *   same value (a consolidation candidate, regardless of name) and variables sharing a name but
 *   disagreeing on value (`signals: ["value-drift"]`).
 * @param files - Style-family source files to scan. Stylus entries are silently skipped (no
 *   shared AST — same limitation as `style-blocks.ts`).
 * @param minOccurrences - Minimum number of declaration sites a shared value/name must have to be
 *   reported (default 2).
 * @returns `defKind: "cssVar"` groups, largest-count-first is not guaranteed here (all such
 *   groups have `lines: 1`) — `findDuplicates` re-sorts the combined result.
 */
export function findStyleVarDuplicates(
  files: StyleSourceFile[],
  minOccurrences = 2,
): DuplicateGroup[] {
  const allDecls = files.flatMap(collectVarDecls);

  const byValue = new Map<string, VarDecl[]>();
  const byName = new Map<string, VarDecl[]>();
  for (const decl of allDecls) {
    const valueBucket = byValue.get(decl.value);
    if (valueBucket) valueBucket.push(decl);
    else byValue.set(decl.value, [decl]);

    const nameBucket = byName.get(decl.name);
    if (nameBucket) nameBucket.push(decl);
    else byName.set(decl.name, [decl]);
  }

  const toOccurrence = (decl: VarDecl, includeValue: boolean): DuplicateOccurrence => ({
    file: decl.file,
    startLine: decl.line,
    endLine: decl.line,
    name: decl.name,
    ...(includeValue ? { value: decl.value } : {}),
  });

  const groups: DuplicateGroup[] = [];

  // Pass 1: consolidation candidates — same value, name irrelevant. Same-file self-declaration
  // at the exact same line can't happen (one decl per collected line), so no dedup needed.
  for (const bucket of byValue.values()) {
    if (bucket.length < minOccurrences) continue;
    groups.push({
      occurrences: bucket.map((decl) => toOccurrence(decl, false)),
      lines: 1,
      tokens: 1,
      kind: "definition",
      defKind: "cssVar",
    });
  }

  // Pass 2: value drift — same name, ≥2 distinct values. A same-name-same-value bucket is
  // already covered by pass 1 and isn't drift, so only fire when values actually disagree.
  for (const bucket of byName.values()) {
    if (bucket.length < minOccurrences) continue;
    const distinctValues = new Set(bucket.map((decl) => decl.value));
    if (distinctValues.size < 2) continue;
    groups.push({
      occurrences: bucket.map((decl) => toOccurrence(decl, true)),
      lines: 1,
      tokens: 1,
      kind: "definition",
      defKind: "cssVar",
      signals: ["value-drift"],
    });
  }

  return groups;
}
