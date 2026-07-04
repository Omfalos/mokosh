export type FileType =
  | "javascript"
  | "typescript"
  | "css"
  | "scss"
  | "less"
  | "stylus"
  | "coffeescript"
  | "livescript"
  | "lua"
  | "gherkin"
  | "python"
  | "go"
  | "unknown";

export type ImportType = "static" | "dynamic" | "require" | "re-export" | "side-effect";

export type NodeCategory = "logic" | "ui" | "type-only" | "config" | "test" | "barrel" | "other";

export type TagKind =
  | "function"
  | "class"
  | "variable"
  | "type"
  | "import"
  | "library"
  | "comment-marker";
