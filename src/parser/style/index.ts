import { getFileType } from "../file-type";
import type { ParseResult } from "../types";
import { detectCssBarrel } from "./barrel";
import { parseCssContent, parseLessContent } from "./css";
import { parseScssContent } from "./scss";
import { detectStylusCategory, parseStylusImports } from "./stylus";

// TODO(SOLID-O): adding a new style dialect (e.g. Sass indented) requires editing this function; consider a parser registry keyed by file type
/**
 * Parses a style file of any supported dialect and returns a normalised `ParseResult`.
 *
 * Delegates to the dialect-specific parser based on the file extension, then wraps the
 * result in the standard shape with empty `exports` and `tags`.
 *
 * @param filePath - Absolute path to the style file; determines which parser is selected
 * @param content - Raw file contents to parse
 * @returns Import edges, empty exports/tags, and a category classification for the file
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
    const { imports, root } = parseScssContent(content, filePath);
    return { imports, exports: [], tags: [], category: detectCssBarrel(root, imports) };
  }

  if (fileType === "less") {
    const { imports, root } = parseLessContent(content, filePath);
    return { imports, exports: [], tags: [], category: detectCssBarrel(root, imports) };
  }

  // css (and any unknown style type)
  const { imports, root } = parseCssContent(content, filePath);
  return { imports, exports: [], tags: [], category: detectCssBarrel(root, imports) };
}
