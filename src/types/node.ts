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
  /** True when this import resolves to a sibling workspace package rather than an external npm dep. */
  isWorkspace?: boolean | undefined;
  /** The workspace package name (e.g. `"@myorg/shared"`) when `isWorkspace` is true. */
  workspacePackage?: string | undefined;
  /** Fraction of the target's exports consumed by this import (0–1). Only present for internal non-side-effect imports where the target has at least one export. */
  exportUsageRatio?: number;
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
  description?: string;
  testedBy?: string[];
  commitCount90d?: number;
  lastAuthor?: string;
  callEdges?: CallEdge[];
  /** Line coverage percentage (0–100) from the last coverage report. Undefined when no report was loaded. */
  coveragePct?: number;
  /** Average exportUsageRatio across all outgoing internal import edges that have a computable ratio. */
  avgExportUsage?: number;
  /** Highest single-edge exportUsageRatio for this file — identifies the dependency whose API surface is most consumed. */
  maxExportUsage?: number;
}
