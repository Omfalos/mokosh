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
  | "unknown";

export type ImportType = "static" | "dynamic" | "require" | "re-export" | "side-effect";

export type NodeCategory = "logic" | "ui" | "type-only" | "config" | "test" | "barrel" | "other";

export type TagKind = "function" | "class" | "variable" | "type" | "import" | "comment-marker";

export interface StructuredTag {
  name: string;
  kind: TagKind;
}

export interface ExportedSymbol {
  name: string;
  doc?: string;
  flags?: string[];
  signature?: string;
}

export interface GraphNode {
  path: string;
  type: FileType;
  category: NodeCategory;
  imports: ImportEdge[];
  exports: ExportedSymbol[];
  tags: StructuredTag[];
}

export interface FileNode extends GraphNode {
  mtime: number;
  size: number;
  description?: string;
  testedBy?: string[];
  commitCount90d?: number;
  lastAuthor?: string;
}

export interface SerializedGraph {
  nodes: FileNode[];
  cycles?: string[][] | undefined;
}

export interface ImportEdge {
  fromPath: string;
  toPath: string;
  isStyle: boolean;
  rawSpecifier: string;
  type: ImportType;
  symbols?: string[] | undefined; // ['add'] for named imports
  isExternal?: boolean | undefined; // New: True for node_modules or absolute paths outside the project
  version?: string | undefined; // Version from lock file
}

export interface DependencyGraph {
  nodes: Map<string, FileNode>;
}

export type TraversalVisitor = (
  node: FileNode,
  depth: number,
  parentPath: string | null,
) => undefined | boolean;

export interface TraversalOptions {
  maxDepth?: number;
  direction?: "outgoing" | "incoming";
}
