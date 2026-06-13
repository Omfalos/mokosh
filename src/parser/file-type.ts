/** Maps file extensions to FileType enum values for use by the parser registry and graph builder. */
import path from "node:path";
import type { FileType } from "../types/parse";

/**
 * @description Maps a file path's extension to its canonical `FileType` identifier,
 *   returning `"unknown"` for unrecognised or unsupported extensions.
 * @param filePath - Absolute or relative path to the source file.
 * @returns The `FileType` string corresponding to the file's language.
 */
export function getFileType(filePath: string): FileType {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".css":
      return "css";
    case ".scss":
    case ".sass":
      return "scss";
    case ".less":
      return "less";
    case ".styl":
      return "stylus";
    case ".coffee":
      return "coffeescript";
    case ".ls":
      return "livescript";
    case ".lua":
      return "lua";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".java":
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".c":
      return "unknown";
    case ".feature":
      return "gherkin";
    default:
      return "unknown";
  }
}

/**
 * @description Checks whether an import specifier refers to a stylesheet by examining
 *   its extension, covering CSS, SCSS/Sass, Less, and Stylus.
 * @param specifier - The raw import specifier string from source code.
 * @returns `true` if the specifier's extension is a known stylesheet format.
 */
export function isStyleFile(specifier: string): boolean {
  const ext = path.extname(specifier).toLowerCase();
  return [".css", ".scss", ".sass", ".less", ".styl"].includes(ext);
}
