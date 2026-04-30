import postcss from "postcss";
import type { ImportEdge } from "../../types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lessParser = require("postcss-less") as {
  parse: postcss.Parser<postcss.Root>;
  stringify: postcss.Stringifier;
};

const SIDE_EFFECT_KEYWORDS = new Set(["reference", "inline"]);

/**
 * Returns true when a CSS import specifier points to an external resource rather than a local file.
 *
 * @param specifier - The raw import path as written in the source (e.g. `~bootstrap`, `https://…`)
 * @returns `true` for tilde-prefixed node_modules, absolute URLs, protocol-relative URLs, and data URIs
 */
function isExternalCss(specifier: string): boolean {
  return (
    specifier.startsWith("~") ||
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("//") ||
    specifier.startsWith("data:")
  );
}

/**
 * Returns true when a `url()` value refers to a file on disk rather than an external or fragment URL.
 *
 * @param specifier - The raw value extracted from a `url()` expression, before any trimming
 * @returns `true` for relative or absolute local paths; `false` for HTTP URLs, protocol-relative URLs, data URIs, and hash fragments
 */
function isLocalUrl(specifier: string): boolean {
  const trimmed = specifier.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.startsWith("http://") &&
    !trimmed.startsWith("https://") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("data:") &&
    !trimmed.startsWith("#")
  );
}

/**
 * Parses the params string of a PostCSS `@import` at-rule into a single import edge.
 *
 * Handles three syntaxes: Less modifier form `(keyword) "path"`, `url("path")`, and bare `"path"`.
 *
 * @param params - The raw text after `@import`, exactly as PostCSS exposes it (no leading `@import`)
 * @param filePath - Absolute path of the file being parsed, used as the `fromPath` of the edge
 * @returns An `ImportEdge` when the params contain a recognisable import path, or `null` for empty or malformed params
 */
function extractAtImportEdge(params: string, filePath: string): ImportEdge | null {
  // Less modifier: (keyword) "path" or (keyword) 'path'
  const lessMatch = params.match(/^\(([^)]+)\)\s+['"]([^'"]+)['"]/);
  if (lessMatch) {
    const keyword = lessMatch[1]?.trim() ?? "";
    const specifier = lessMatch[2] ?? "";
    if (!specifier) return null;
    const type = SIDE_EFFECT_KEYWORDS.has(keyword) ? "side-effect" : "static";
    return {
      fromPath: filePath,
      toPath: "",
      rawSpecifier: specifier,
      isStyle: true,
      type,
      ...(isExternalCss(specifier) ? { isExternal: true } : {}),
    };
  }
  // url() form: url("path") or url('path') or url(path)
  const urlMatch = params.match(/^url\(['"]?([^'")]+)['"]?\)/);
  const specifier = urlMatch
    ? (urlMatch[1]?.trim() ?? "")
    : (params.match(/^['"]([^'"]+)['"]/)?.[1] ?? "");
  if (!specifier) return null;
  return {
    fromPath: filePath,
    toPath: "",
    rawSpecifier: specifier,
    isStyle: true,
    type: "static",
    ...(isExternalCss(specifier) ? { isExternal: true } : {}),
  };
}

/**
 * Extracts all local `url()` references from a single CSS declaration value as import edges.
 *
 * @param value - The raw CSS property value string (e.g. `url("./bg.png") center`)
 * @param filePath - Absolute path of the file being parsed, used as `fromPath` on each edge
 * @returns One edge per local `url()` found; external URLs and data URIs are skipped
 */
function extractUrlDeclarationEdges(value: string, filePath: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const urlPattern = /url\(['"]?([^'")]+)['"]?\)/g;
  let match = urlPattern.exec(value);
  while (match !== null) {
    const specifier = match[1]?.trim() ?? "";
    if (isLocalUrl(specifier)) {
      edges.push({
        fromPath: filePath,
        toPath: "",
        rawSpecifier: specifier,
        isStyle: true,
        type: "static",
      });
    }
    match = urlPattern.exec(value);
  }
  return edges;
}

/**
 * Walks a parsed PostCSS tree and collects every import edge — both `@import` at-rules and `url()` references in declarations.
 *
 * @param root - The PostCSS root node produced by parsing a CSS or Less file
 * @param filePath - Absolute path of the source file; forwarded to edge constructors as `fromPath`
 * @returns All import edges found in the tree, in document order
 */
function collectEdgesFromRoot(root: postcss.Root, filePath: string): ImportEdge[] {
  const imports: ImportEdge[] = [];
  root.walk((node) => {
    if (node.type === "atrule" && node.name === "import") {
      const edge = extractAtImportEdge(node.params, filePath);
      if (edge) imports.push(edge);
    }
    if (node.type === "decl") {
      imports.push(...extractUrlDeclarationEdges(node.value, filePath));
    }
  });
  return imports;
}

/**
 * Removes `//` line comments from CSS source so PostCSS can parse files that use non-standard comment syntax.
 *
 * @param content - Raw CSS file contents, potentially containing `//` comments
 * @returns The content with `//`-to-end-of-line sequences removed, leaving `://` (URLs) intact
 */
function stripLineComments(content: string): string {
  // `//` is not valid CSS but is widely used; strip before passing to PostCSS.
  // Negative lookbehind on `:` avoids stripping `//` inside `https://` or `http://` URLs.
  return content.replace(/(?<!:)\/\/.*/g, "");
}

/**
 * Extracts `@import` edges from raw CSS/Less source using a regex when the PostCSS parser fails.
 *
 * Only captures `@import` at-rules; `url()` references in declarations are not extracted here.
 *
 * @param content - Raw file contents that could not be parsed by PostCSS
 * @param filePath - Absolute path of the file being parsed, used as `fromPath` on each edge
 * @returns All `@import` edges found by pattern matching, with no barrel/side-effect detection for url() forms
 */
function regexFallbackImports(content: string, filePath: string): ImportEdge[] {
  const imports: ImportEdge[] = [];
  const atImportPattern = /@import\s+(?:\(([^)]+)\)\s+)?['"]([^'"]+)['"]/g;
  let match = atImportPattern.exec(content);
  while (match !== null) {
    const keyword = match[1]?.trim() ?? "";
    const specifier = match[2] ?? "";
    if (specifier) {
      const type = SIDE_EFFECT_KEYWORDS.has(keyword) ? "side-effect" : "static";
      imports.push({
        fromPath: filePath,
        toPath: "",
        rawSpecifier: specifier,
        isStyle: true,
        type,
      });
    }
    match = atImportPattern.exec(content);
  }
  return imports;
}

/**
 * Parses a CSS file and returns its import edges alongside the PostCSS AST.
 *
 * Strips non-standard `//` line comments before parsing so that common CSS-in-JS
 * and preprocessor conventions do not cause a parse error.
 *
 * @param content - Raw CSS file contents
 * @param filePath - Absolute path of the file; used as `fromPath` on each returned edge
 * @returns The collected import edges and the PostCSS root, which callers use for barrel detection
 */
export function parseCssContent(
  content: string,
  filePath: string,
): { imports: ImportEdge[]; root: postcss.Root } {
  // Strip // line comments — not valid CSS but common; PostCSS throws on them
  const root = postcss.parse(stripLineComments(content));
  return { imports: collectEdgesFromRoot(root, filePath), root };
}

/**
 * Parses a Less file and returns its import edges alongside the PostCSS AST.
 *
 * Falls back to regex-only extraction when `postcss-less` throws, so mixed or malformed
 * Less files still yield at least the `@import` edges (barrel detection will receive an empty root).
 *
 * @param content - Raw Less file contents
 * @param filePath - Absolute path of the file; used as `fromPath` on each returned edge
 * @returns The collected import edges and the PostCSS root (may be empty on parse failure)
 */
export function parseLessContent(
  content: string,
  filePath: string,
): { imports: ImportEdge[]; root: postcss.Root } {
  try {
    const root = lessParser.parse(content);
    return { imports: collectEdgesFromRoot(root, filePath), root };
  } catch {
    // Fallback when content mixes non-Less syntax (e.g., bare `import` without @).
    // Use regex to extract @import edges only; barrel detection gets an empty root.
    return { imports: regexFallbackImports(content, filePath), root: postcss.parse("") };
  }
}
