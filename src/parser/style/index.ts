/** Dispatches style file parsing to the appropriate dialect handler (CSS, Less, SCSS, Sass, Stylus). */
import { getFileType } from "../file-type";
import type { ParseResult } from "../types";
import { detectCssBarrel } from "./barrel";
import { parseCssContent, parseLessContent } from "./css";
import { parseScssContent } from "./scss";
import { detectStylusCategory, parseStylusImports } from "./stylus";

// TODO(SOLID-O): adding a new style dialect (e.g. Sass indented) requires editing this function; consider a parser registry keyed by file type
/**
 * @description Parses a style file of any supported dialect and returns a normalised `ParseResult`.
 *   Delegates to the dialect-specific parser based on the file extension, then wraps the result in the
 *   standard shape. SCSS and Less populate `exports`/`tags` from their root-level variable/mixin/function
 *   declarations (see `parseScssContent`, `parseLessContent`); CSS and Stylus have no equivalent module
 *   surface today, so they always report empty `exports`/`tags`.
 * @param {string} filePath - Absolute path to the style file; determines which parser is selected
 * @param {string} content - Raw file contents to parse
 * @returns {ParseResult} Import edges, exports/tags (SCSS/Less only), and a category classification for the file
 */
export function parseStyleFile(filePath: string, content: string): ParseResult {
  const fileType = getFileType(filePath);

  if (fileType === "stylus") {
    const imports = parseStylusImports(content, filePath);
    return {
      imports,
      exports: [],
      tags: [],
      category: detectStylusCategory(content, imports),
    };
  }

  if (fileType === "scss") {
    const { imports, root, exports, tags } = parseScssContent(content, filePath);
    return { imports, exports, tags, category: detectCssBarrel(root, imports) };
  }

  if (fileType === "less") {
    const { imports, root, exports, tags } = parseLessContent(content, filePath);
    return { imports, exports, tags, category: detectCssBarrel(root, imports) };
  }

  // css (and any unknown style type)
  const { imports, root } = parseCssContent(content, filePath);
  return { imports, exports: [], tags: [], category: detectCssBarrel(root, imports) };
}
