import type { FileNode } from "./node";

export interface SerializedGraph {
  nodes: FileNode[];
  cycles?: string[][] | undefined;
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
