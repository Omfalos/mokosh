/** GraphExporter implementation that renders dependency graphs as Mermaid flowchart diagrams. */
import type { Graph } from "../graph";
import type { GraphExporter } from "./types";

/**
 * @description GraphExporter implementation that renders dependency graphs as Mermaid diagrams.
 *   Use this directly or pass it anywhere a GraphExporter is accepted.
 */
export const MermaidExporter: GraphExporter = {
  /**
   * @description Serializes the dependency graph into a Mermaid `graph TD` diagram,
   *   rendering import edges as arrows and style imports with a labelled edge variant.
   * @param graph - The dependency graph whose nodes and edges to serialize.
   * @returns A Mermaid diagram string starting with `graph TD`.
   */
  serialize(graph: Graph): string {
    const lines: string[] = ["graph TD"];
    const visitedEdges = new Set<string>();

    for (const node of graph.nodes.values()) {
      const nodeLabel = `"${node.path}"`;
      for (const imp of node.imports) {
        if (!imp.toPath) continue;
        const targetLabel = `"${imp.toPath}"`;
        const edgeKey = `${node.path} -> ${imp.toPath}`;

        if (!visitedEdges.has(edgeKey)) {
          const edgeStyle = imp.isStyle ? "-- styles -->" : "-->";
          lines.push(`  ${nodeLabel} ${edgeStyle} ${targetLabel}`);
          visitedEdges.add(edgeKey);
        }
      }
    }
    return lines.join("\n");
  },
};

/**
 * @description Convenience wrapper around MermaidExporter.serialize.
 * @param graph - The dependency graph to render.
 * @returns A Mermaid `graph TD` diagram string.
 */
export function toMermaid(graph: Graph): string {
  return MermaidExporter.serialize(graph);
}
