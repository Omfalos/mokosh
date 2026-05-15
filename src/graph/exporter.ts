import type { Graph } from "./model";

export const MermaidExporter = {
  /**
   * @description Serializes the dependency graph into a Mermaid `graph TD` diagram,
   *   rendering import edges as arrows and style imports with a labelled edge variant.
   * @param graph - The dependency graph whose nodes and edges to serialize.
   * @returns A Mermaid diagram string starting with `graph TD`.
   */
  toMermaid(graph: Graph): string {
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
