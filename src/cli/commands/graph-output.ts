import { filterGraph, Graph, MermaidExporter, parseQuery } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Serializes the dependency graph, optionally narrowing it with a query filter,
 *   then prints it as a Mermaid diagram or a JSON object that includes detected cycles.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, queryStr, mermaidOutput } = ctx;
  let serialized = graph.serialize();

  if (queryStr) {
    const query = parseQuery(queryStr);
    serialized = filterGraph(serialized, query);
  }

  if (mermaidOutput) {
    const filteredGraph = Graph.deserialize(serialized);
    console.log(MermaidExporter.toMermaid(filteredGraph));
  } else {
    const cycles = graph.findCycles();
    if (cycles.length > 0) {
      serialized.cycles = cycles;
    }
    console.log(JSON.stringify(serialized, null, 2));
  }
}
