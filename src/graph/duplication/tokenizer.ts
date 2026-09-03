/**
 * Language-agnostic source tokenizer for duplicate-code detection. Strips per-language
 * comment syntax and import/using statements, then splits what remains into a normalized token stream shared by every
 * language `DEFAULT_EXTENSIONS` covers — one generic tokenizer rather than a per-language
 * lexer, so `findDuplicates` works uniformly across TS/JS, Python, Go, Java, Kotlin, Scala,
 * Groovy, CoffeeScript, LiveScript, Lua, Gherkin, style files, and Markdown.
 */
import type { FileType } from "../../types/parse";

/** One normalized token plus the 1-based source line it came from. */
export interface NormalizedToken {
  text: string;
  line: number;
}

interface CommentSyntax {
  line?: string[];
  block?: Array<[string, string]>;
}

/**
 * Per-`FileType` comment markers used to mask out comment text before tokenizing, so comment
 * wording never contributes to a duplicate match. Deliberately not string-literal-aware — a
 * `//` inside a string is rare and the cost of occasionally over-stripping is low for a
 * heuristic duplicate finder, same trade-off the complexity scorers make elsewhere.
 */
const COMMENT_SYNTAX: Partial<Record<FileType, CommentSyntax>> = {
  typescript: { line: ["//"], block: [["/*", "*/"]] },
  javascript: { line: ["//"], block: [["/*", "*/"]] },
  go: { line: ["//"], block: [["/*", "*/"]] },
  java: { line: ["//"], block: [["/*", "*/"]] },
  kotlin: { line: ["//"], block: [["/*", "*/"]] },
  scala: { line: ["//"], block: [["/*", "*/"]] },
  groovy: { line: ["//"], block: [["/*", "*/"]] },
  css: { block: [["/*", "*/"]] },
  scss: { line: ["//"], block: [["/*", "*/"]] },
  less: { line: ["//"], block: [["/*", "*/"]] },
  stylus: { line: ["//"], block: [["/*", "*/"]] },
  python: { line: ["#"] },
  gherkin: { line: ["#"] },
  coffeescript: { line: ["#"], block: [["###", "###"]] },
  livescript: { line: ["#"], block: [["###", "###"]] },
  lua: { line: ["--"], block: [["--[[", "]]"]] },
  markdown: { block: [["<!--", "-->"]] },
};

/**
 * @description Replaces every non-newline character in `source[start, end)` with a space,
 *   so downstream line-number tracking stays correct while the masked text can no longer
 *   match anything.
 * @param source - Full file source.
 * @param start - Start offset (inclusive) of the range to mask.
 * @param end - End offset (exclusive) of the range to mask.
 * @returns `source` with the range masked.
 */
function maskRange(source: string, start: number, end: number): string {
  const masked = source.slice(start, end).replace(/[^\n]/g, " ");
  return source.slice(0, start) + masked + source.slice(end);
}

/**
 * @description Masks out every line and block comment matching `syntax`, preserving line
 *   breaks and overall string length so line numbers computed later stay accurate.
 * @param source - Full file source.
 * @param syntax - Comment markers for the file's language; absent for languages with no
 *   configured comment syntax, in which case the source passes through unchanged.
 * @returns The source with comment text masked to spaces.
 */
function stripComments(source: string, syntax: CommentSyntax | undefined): string {
  if (!syntax) return source;
  let result = source;

  for (const [open, close] of syntax.block ?? []) {
    let searchFrom = 0;
    for (;;) {
      const start = result.indexOf(open, searchFrom);
      if (start === -1) break;
      const end = result.indexOf(close, start + open.length);
      const rangeEnd = end === -1 ? result.length : end + close.length;
      result = maskRange(result, start, rangeEnd);
      searchFrom = rangeEnd;
    }
  }

  for (const marker of syntax.line ?? []) {
    let searchFrom = 0;
    for (;;) {
      const start = result.indexOf(marker, searchFrom);
      if (start === -1) break;
      const lineEnd = result.indexOf("\n", start);
      const rangeEnd = lineEnd === -1 ? result.length : lineEnd;
      result = maskRange(result, start, rangeEnd);
      searchFrom = rangeEnd;
    }
  }

  return result;
}

/**
 * Per-`FileType` patterns matching a *single* import/using line. Long shared import lists
 * tokenize identically across unrelated files and register as "duplicates" that carry no shared
 * logic — same rationale as stripping comments. Masked (space-filled, line breaks kept) before
 * tokenizing. Deliberately coarse and not string-literal-aware, like `stripComments`.
 */
const IMPORT_LINE_PATTERNS: Partial<Record<FileType, RegExp[]>> = {
  typescript: [/^\s*import[\s{("*]/, /^\s*export\s.*\sfrom\s/],
  javascript: [/^\s*import[\s{("*]/, /^\s*export\s.*\sfrom\s/],
  python: [/^\s*import\s+\S/, /^\s*from\s+\S+\s+import[\s(]/],
  go: [/^\s*import\s+["(]/],
  java: [/^\s*import\s+/],
  kotlin: [/^\s*import\s+/],
  scala: [/^\s*import\s+/],
  groovy: [/^\s*import\s+/],
};

/**
 * @description Masks import / `from … import` / `using` statements to spaces before tokenizing,
 *   preserving line breaks so later line-number tracking stays accurate. Handles the two
 *   multi-line shapes that matter in practice: a JS/TS `import { … } from "x"` whose braces span
 *   lines, and a Go `import ( … )` block. Everything else is matched line-by-line.
 * @param source - File source, already comment-stripped.
 * @param fileType - Selects the import-line patterns; unrecognised types pass through unchanged.
 * @returns The source with import statements masked to spaces.
 */
function stripImports(source: string, fileType: FileType): string {
  const patterns = IMPORT_LINE_PATTERNS[fileType];
  if (!patterns) return source;

  const lines = source.split("\n");
  const isGo = fileType === "go";
  let inGoBlock = false;
  let inJsBraces = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const mask = () => {
      lines[i] = line.replace(/[^\r]/g, " ");
    };

    if (inGoBlock) {
      mask();
      if (line.includes(")")) inGoBlock = false;
      continue;
    }
    if (inJsBraces) {
      mask();
      if (/}\s*from\s/.test(line) || line.includes("}")) inJsBraces = false;
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(line))) continue;

    mask();
    if (isGo && /^\s*import\s+\(/.test(line) && !line.includes(")")) inGoBlock = true;
    else if (
      (fileType === "typescript" || fileType === "javascript") &&
      /^\s*import\b/.test(line) &&
      line.includes("{") &&
      !line.includes("}")
    ) {
      inJsBraces = true;
    }
  }

  return lines.join("\n");
}

const MULTI_CHAR_OPERATORS = [
  "===",
  "!==",
  "...",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "::",
  "->",
  "..",
  "+=",
  "-=",
  "*=",
  "/=",
];

/** Matches, in priority order: multi-char operators, identifiers, numbers, and quoted strings. */
const TOKEN_PATTERN = new RegExp(
  `${MULTI_CHAR_OPERATORS.map((op) => op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|[A-Za-z_$][A-Za-z0-9_$]*|\\d+(?:\\.\\d+)?|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\S`,
  "g",
);

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NUMBER_PATTERN = /^\d+(?:\.\d+)?$/;
const STRING_PATTERN = /^(".*"|'.*'|`.*`)$/s;

/**
 * Keywords kept verbatim rather than collapsed to the `ID` placeholder, shared across every
 * language rather than a per-language keyword table — deliberately coarse. Without this,
 * structurally different code (an `if` vs. a `for`, a `class` vs. a `function`) would tokenize
 * identically once every identifier-shaped word became `ID`, which would make the shingle
 * matcher far too eager. This list only needs to cover the keywords common enough across
 * TS/JS/Python/Go/CoffeeScript/LiveScript/Lua/Gherkin to matter for shape-preservation — it
 * doesn't need to be exhaustive or language-precise, since keeping a non-keyword here just
 * costs a little precision, not correctness.
 */
const KEYWORDS = new Set([
  "if",
  "else",
  "elif",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "return",
  "function",
  "def",
  "class",
  "struct",
  "interface",
  "const",
  "let",
  "var",
  "local",
  "import",
  "export",
  "from",
  "package",
  "try",
  "catch",
  "except",
  "finally",
  "throw",
  "raise",
  "new",
  "this",
  "self",
  "end",
  "then",
  "yield",
  "async",
  "await",
  "nil",
  "null",
  "None",
  "true",
  "false",
  "True",
  "False",
  "and",
  "or",
  "not",
  "in",
  "of",
  "is",
]);

/**
 * @description Tokenizes source text into a normalized stream for shingle-based duplicate
 *   matching: comments and import/using statements are masked out first (shared import lists are
 *   not shared logic), then identifiers always collapse to a single placeholder (so
 *   renamed-variable clones still hash identically), and literals optionally collapse too
 *   (`ignoreLiterals`, default on) so only structural shape — not the specific values used —
 *   drives the match.
 * @param source - Raw file content.
 * @param fileType - Selects the comment- and import-stripping rules; unrecognised types skip both.
 * @param ignoreLiterals - When true (default), string/number literal tokens are also
 *   normalized to a placeholder rather than compared verbatim.
 * @returns Normalized tokens in source order, each carrying its 1-based source line.
 */
export function tokenize(
  source: string,
  fileType: FileType,
  ignoreLiterals = true,
): NormalizedToken[] {
  const stripped = stripImports(stripComments(source, COMMENT_SYNTAX[fileType]), fileType);
  const tokens: NormalizedToken[] = [];

  let line = 1;
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(stripped);

  while (match !== null) {
    for (let i = lastIndex; i < match.index; i++) {
      if (stripped[i] === "\n") line++;
    }
    lastIndex = match.index;

    const raw = match[0];
    let text = raw;
    if (IDENTIFIER_PATTERN.test(raw) && !KEYWORDS.has(raw)) {
      text = "ID";
    } else if (ignoreLiterals && (NUMBER_PATTERN.test(raw) || STRING_PATTERN.test(raw))) {
      text = NUMBER_PATTERN.test(raw) ? "NUM" : "STR";
    }
    tokens.push({ text, line });

    for (let i = lastIndex; i < match.index + raw.length; i++) {
      if (stripped[i] === "\n") line++;
    }
    lastIndex = match.index + raw.length;
    match = TOKEN_PATTERN.exec(stripped);
  }

  return tokens;
}
