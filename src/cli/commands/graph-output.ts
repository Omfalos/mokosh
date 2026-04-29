import { filterGraph, Graph, MermaidExporter, parseQuery } from "../../index";
import type { CommandContext } from "./types";

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
