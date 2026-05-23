import type { Graph } from "../graph";

/**
 * @description Contract for graph serializers. Implement this to add a new export format
 *   (e.g. Graphviz DOT, JSON, SVG) without touching the core graph model.
 */
export interface GraphExporter {
  /**
   * @description Converts a dependency graph into a serialized string in the exporter's target format.
   * @param graph - The fully-built dependency graph to serialize.
   * @returns A string representation of the graph in the target format (e.g. Mermaid, DOT).
   */
  serialize(graph: Graph): string;
}