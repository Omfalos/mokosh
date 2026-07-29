import { describe, expect, it } from "vitest";
import { OPTIONS } from "../cli/args";
import { TOOL_DEFINITIONS } from "./tools";

/**
 * Every MCP tool (except `analyze`, which has no CLI equivalent — the CLI builds the graph
 * implicitly) has a matching CLI flag, by convention: replace underscores with hyphens, then
 * strip a leading `get-` prefix. `get_callers` -> `callers`, `get_call_graph` -> `call-graph`,
 * `find_symbol` -> `find-symbol`, `check_doc_drift` -> `check-doc-drift`, `query` -> `query`.
 *
 * This test exists so a new MCP tool shipped without its CLI flag fails immediately instead of
 * relying on manual review to catch the gap.
 */
function expectedCliFlag(toolName: string): string {
  const kebab = toolName.replace(/_/g, "-");
  return kebab.startsWith("get-") ? kebab.slice("get-".length) : kebab;
}

describe("MCP tool / CLI flag parity", {
  tags: ["tool-cli-parity", "TOOL_DEFINITIONS", "OPTIONS"],
}, () => {
  const toolsRequiringCliFlag = TOOL_DEFINITIONS.filter((tool) => tool.name !== "analyze");

  it.each(
    toolsRequiringCliFlag.map((tool) => ({
      toolName: tool.name,
      flag: expectedCliFlag(tool.name),
    })),
  )("$toolName has a matching --$flag CLI flag", ({ flag }) => {
    expect(OPTIONS).toHaveProperty(flag);
  });

  it("covers every non-analyze tool currently defined", () => {
    expect(toolsRequiringCliFlag.length).toBe(TOOL_DEFINITIONS.length - 1);
  });
});
