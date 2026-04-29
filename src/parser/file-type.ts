import path from "node:path";
import type { FileType } from "../types";

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

export function isStyleFile(specifier: string): boolean {
  const ext = path.extname(specifier).toLowerCase();
  return [".css", ".scss", ".sass", ".less", ".styl"].includes(ext);
}
