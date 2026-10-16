/** Shared "this tool needs mokosh.config.json" response, used by the MCP handlers and CLI twins. */
import path from "node:path";

export type MissingConfig = "coverage" | "gitStats";
export type ConfigRequiredSurface = "mcp" | "cli";

export interface ConfigRequiredPayload {
  error: "CONFIG_REQUIRED";
  tool: string;
  reason: string;
  missingConfig: MissingConfig;
  fix: {
    file: string;
    add: Record<string, unknown>;
    alternatives: Record<string, unknown>[];
    notes: string[];
  };
  nextSteps: string[];
}

const COVERAGE_FIX = {
  reason: "No coverage data was loaded, so every file would look 0% covered.",
  add: { coverage: { mode: "static" } },
  alternatives: [
    { coverageReportPath: "<path to an Istanbul coverage-summary.json>" },
    {
      coverage: { mode: "exec" },
      note: "Runs the project's real test suite; slow on large repos.",
    },
  ],
};

const GIT_STATS_FIX = {
  reason: "No git commit-timestamp data was loaded, so no doc can be compared against its sources.",
  add: { gitStats: true },
  alternatives: [] as Record<string, unknown>[],
};

/**
 * @description Builds the structured "config required" response returned when a tool's data source
 *   (coverage or git stats) was never loaded. Names the exact file, the JSON to add and the calls to
 *   make afterwards, so an LLM can fix it without guessing. Only `mokosh.config.json` is read by the
 *   MCP server (`.js` configs are ignored there), so that is the file named.
 * @param {object} params - `tool` is the tool name, `root` the project root, `missing` which config
 *   is absent, and `surface` picks MCP tool names vs. CLI wording for the follow-up steps.
 * @returns {ConfigRequiredPayload} The payload to serialize to the caller.
 */
export function buildConfigRequired(params: {
  tool: string;
  root: string;
  missing: MissingConfig;
  surface?: ConfigRequiredSurface;
}): ConfigRequiredPayload {
  const { tool, root, missing, surface = "mcp" } = params;
  const spec = missing === "coverage" ? COVERAGE_FIX : GIT_STATS_FIX;
  const notes = [
    "Only mokosh.config.json is read by the MCP server; mokosh.config.js is ignored.",
    "Ask the user before writing into their repo. If mokosh.config.json already exists, merge this key into it instead of replacing the file.",
  ];
  if (tool === "find_risk_hotspots" && missing === "gitStats") {
    notes.push("gitStats is optional here; it only enables the churn filter.");
  }
  return {
    error: "CONFIG_REQUIRED",
    tool,
    reason: spec.reason,
    missingConfig: missing,
    fix: {
      file: path.join(root, "mokosh.config.json"),
      add: spec.add,
      alternatives: spec.alternatives,
      notes,
    },
    nextSteps:
      surface === "mcp"
        ? ["clear_cache", "analyze", tool]
        : [
            `re-run \`mokosh\` with --${tool.replace(/_/g, "-")} (the graph is rebuilt with the new config)`,
          ],
  };
}
