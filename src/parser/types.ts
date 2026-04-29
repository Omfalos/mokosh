import type { ImportEdge, NodeCategory } from "../types";

export interface ParseContext {
  filePath: string;
  imports: ImportEdge[];
  exports: Set<string>;
  tags: Set<string>;
  hasUI: boolean;
  hasTypesOnly: boolean;
  totalStatements: number;
  exportStatements: number;
}

export interface ParseResult {
  imports: ImportEdge[];
  exports: string[];
  tags: string[];
  category: NodeCategory;
}
