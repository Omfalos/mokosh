import type ts from "typescript";
import type { ExportedSymbol, ImportEdge, NodeCategory, StructuredTag } from "../types";

export interface RawCallEdge {
  from: string;
  to: string;
  toSpecifier: string;
}

export interface ParseContext {
  filePath: string;
  imports: ImportEdge[];
  exports: Map<string, ExportedSymbol>;
  tags: Set<StructuredTag>;
  rawCallEdges?: RawCallEdge[];
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
  rawCallEdges?: RawCallEdge[];
  description?: string;
  /** McCabe cyclomatic complexity of the file (base 1, undefined for non-TS/JS files). */
  complexity?: number;
  /** Cognitive complexity — nesting-aware difficulty score (undefined for non-TS/JS files). */
  cognitiveComplexity?: number;
}
