/** CLI command: outputs the dependency graph as Mermaid or JSON, optionally filtered by a query. */
import { filterGraph, Graph, MermaidExporter, parseQuery, slimSerialize } from "../../index";
import type { CommandContext } from "./types";

/**
 * @description Serializes the dependency graph, optionally narrowing it with a query filter,
 *   then prints it as a Mermaid diagram or a JSON object that includes detected cycles.
 *   Pass `--slim` for a compact response (export names, meaningful tags, flat importsFiles list) —
 *   matching the MCP `query` tool's default shape; the CLI defaults to the full shape (`--slim` false)
 *   to preserve existing script compatibility.
 * @param {CommandContext} ctx - Command context carrying the built graph, an optional query string, and the mermaid/slim output flags.
 */
export async function run(ctx: CommandContext): Promise<void> {
  const { graph, queryStr, mermaidOutput, slim } = ctx;
  let serialized = graph.serialize();

  if (queryStr) {
    const query = parseQuery(queryStr);
    serialized = filterGraph(serialized, query);
  }

  if (mermaidOutput) {
    const filteredGraph = Graph.deserialize(serialized);
    console.log(MermaidExporter.serialize(filteredGraph));
    return;
  }

  const cycles = graph.findCycles();
  if (cycles.length > 0) {
    serialized.cycles = cycles;
  }

  if (slim) {
    console.log(JSON.stringify(slimSerialize(serialized), null, 2));
  } else {
    console.log(JSON.stringify(serialized, null, 2));
  }
}
