import type { FileType, ImportType, NodeCategory, TagKind } from "./parse";

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

export interface ImportEdge {
  fromPath: string;
  toPath: string;
  isStyle: boolean;
  rawSpecifier: string;
  type: ImportType;
  symbols?: string[] | undefined;
  isExternal?: boolean | undefined;
  version?: string | undefined;
}

export interface CallEdge {
  from: string;
  to: string;
  toFile: string;
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
  testedBy?: string[];
  commitCount90d?: number;
  lastAuthor?: string;
  callEdges?: CallEdge[];
}
