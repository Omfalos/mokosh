import type ts from "typescript";
import type { ExportedSymbol, ImportEdge, NodeCategory, StructuredTag } from "../types";

export interface ParseContext {
  filePath: string;
  imports: ImportEdge[];
  exports: Map<string, ExportedSymbol>;
  tags: Set<StructuredTag>;
  sourceFile: ts.SourceFile;
  hasUI: boolean;
  hasTypesOnly: boolean;
  totalStatements: number;
  exportStatements: number;
}

export interface ParseResult {
  imports: ImportEdge[];
  exports: ExportedSymbol[];
  tags: StructuredTag[];
  category: NodeCategory;
  description?: string;
}
