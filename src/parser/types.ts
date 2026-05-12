import type { ImportEdge, NodeCategory, StructuredTag } from "../types";

export interface ParseContext {
  filePath: string;
  imports: ImportEdge[];
  exports: Set<string>;
  tags: Set<StructuredTag>;
  hasUI: boolean;
  hasTypesOnly: boolean;
  totalStatements: number;
  exportStatements: number;
}

export interface ParseResult {
  imports: ImportEdge[];
  exports: string[];
  tags: StructuredTag[];
  category: NodeCategory;
}
