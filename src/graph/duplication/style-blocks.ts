/**
 * Structural (not token-shingled) duplicate detection for CSS-family "block definitions" — a
 * rule's declaration *body* (its literal, ordered `property: value` pairs), independent of the
 * rule's own selector. Reuses the PostCSS ASTs the CSS/Less/SCSS parsers already build
 * (`src/parser/style/*`) instead of a generic token window, so matching happens on the actual
 * declaration content rather than a normalized token shape — a `display: flex` rule and a
 * `display: block` rule can never register as a duplicate just because both collapse to the same
 * `ID : ID ;` shape, which was the false-positive mode the token-shingle path had for CSS. See
 * docs/adr-013-duplicate-detection-noise-reduction.md.
 *
 * Stylus is deliberately excluded: it has no PostCSS-compatible AST available in this codebase
 * (`src/parser/style/stylus.ts` only regex-extracts imports), so Stylus files still fall back to
 * the generic token-shingle pipeline in `tokenizer.ts`/`shingle.ts`.
 */
import type postcss from "postcss";
import { parseCssContent, parseLessContent } from "../../parser/style/css";
import { parseScssContent } from "../../parser/style/scss";
import type { FileType } from "../../types/parse";
import type { DuplicateGroup, DuplicateOccurrence } from "./shingle";

export interface StyleSourceFile {
  file: string;
  source: string;
  fileType: FileType;
}

interface RuleBlock {
  file: string;
  startLine: number;
  endLine: number;
  lines: number;
  signature: string;
  declCount: number;
}

/**
 * @description Collapses a declaration value to a comparable form without touching its literal
 *   content — only incidental whitespace differences (copy-pasted code reformatted by a linter,
 *   say) are normalized away. Shared with `style-vars.ts`.
 * @param value - A declaration's raw PostCSS `value`.
 * @returns The value trimmed and with internal whitespace runs collapsed to one space.
 */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * @description Parses one style file into a PostCSS AST using the same dialect-specific parser
 *   `src/parser/style/index.ts` dispatches to, so block extraction sees exactly what the graph
 *   builder saw. Returns `undefined` for Stylus (no shared AST) or on a parse failure. Shared
 *   with `style-vars.ts`.
 * @param file - The file to parse; `fileType` selects the CSS/Less/SCSS dialect.
 * @returns The parsed PostCSS root, or `undefined` when structural parsing isn't available.
 */
export function parseStyleAst(file: StyleSourceFile): postcss.Root | undefined {
  try {
    if (file.fileType === "scss") return parseScssContent(file.source, file.file).root;
    if (file.fileType === "less") return parseLessContent(file.source, file.file).root;
    if (file.fileType === "css") return parseCssContent(file.source, file.file).root;
    return undefined;
  } catch {
    // Malformed input the dialect parser couldn't recover from — skip rather than throw, same
    // trade-off the token-shingle path makes for unreadable files.
    return undefined;
  }
}

/**
 * @description Walks a style file's AST and extracts every rule's declaration body as a
 *   comparable block, regardless of nesting depth (`@media`-wrapped and SCSS-nested rules are
 *   walked the same as top-level ones).
 * @param file - The file to extract rule blocks from.
 * @returns One `RuleBlock` per rule that has at least one declaration.
 */
function collectRuleBlocks(file: StyleSourceFile): RuleBlock[] {
  const root = parseStyleAst(file);
  if (!root) return [];
  const blocks: RuleBlock[] = [];

  root.walkRules((rule) => {
    const decls = rule.nodes?.filter((node) => node.type === "decl") ?? [];
    if (decls.length === 0) return;

    const firstDecl = decls[0];
    const lastDecl = decls[decls.length - 1];
    const startLine = rule.source?.start?.line ?? firstDecl?.source?.start?.line;
    const endLine = lastDecl?.source?.end?.line ?? lastDecl?.source?.start?.line ?? startLine;
    if (startLine === undefined || endLine === undefined) return;

    const signature = decls
      .map((decl) => `${decl.prop.trim().toLowerCase()}:${normalizeValue(decl.value)}`)
      .join(";");

    blocks.push({
      file: file.file,
      startLine,
      endLine,
      lines: endLine - startLine + 1,
      signature,
      declCount: decls.length,
    });
  });

  return blocks;
}

/**
 * @description Finds duplicated CSS/Less/SCSS rule *bodies* — the literal, ordered set of
 *   `property: value` declarations a rule contains — independent of the rule's own selector.
 *   Two rules with different selectors but an identical declaration list are reported (a real
 *   "should this become a shared class or mixin" signal); two rules that merely share
 *   declaration *shape* but differ in property or value never are, unlike generic token-shingle
 *   matching.
 * @param files - Style-family source files to scan. Stylus entries are silently skipped —
 *   callers should route them through the token-shingle path instead.
 * @param minLines - Minimum line span a duplicated block must cover to be reported.
 * @param minDeclarations - Minimum number of declarations a duplicated block must contain, so a
 *   single shared one-liner (e.g. `display: none;` alone) doesn't count as duplication.
 * @returns Duplicate blocks, each a pair of occurrences, sorted largest-first. Every group is
 *   tagged `family: "style"`.
 */
export function findStyleBlockDuplicates(
  files: StyleSourceFile[],
  minLines: number,
  minDeclarations = 2,
): DuplicateGroup[] {
  const buckets = new Map<string, RuleBlock[]>();
  for (const file of files) {
    for (const block of collectRuleBlocks(file)) {
      if (block.declCount < minDeclarations || block.lines < minLines) continue;
      const bucket = buckets.get(block.signature);
      if (bucket) bucket.push(block);
      else buckets.set(block.signature, [block]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i] as RuleBlock;
        const b = bucket[j] as RuleBlock;
        // Same-file self-match on the exact same span isn't a real duplicate.
        if (a.file === b.file && a.startLine === b.startLine && a.endLine === b.endLine) continue;

        const occA: DuplicateOccurrence = {
          file: a.file,
          startLine: a.startLine,
          endLine: a.endLine,
        };
        const occB: DuplicateOccurrence = {
          file: b.file,
          startLine: b.startLine,
          endLine: b.endLine,
        };
        groups.push({
          occurrences: [occA, occB],
          lines: Math.min(a.lines, b.lines),
          tokens: a.declCount,
          family: "style",
        });
      }
    }
  }

  return groups.sort((a, b) => b.lines - a.lines);
}
