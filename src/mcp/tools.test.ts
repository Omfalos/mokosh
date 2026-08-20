import { describe, expect, test } from "vitest";
import { TOOL_DEFINITIONS } from "./tools";

/**
 * Regression guard on the static ListTools payload — this schema is sent verbatim on every
 * session's first tool-list call, so its size is a fixed tax paid regardless of what the caller
 * actually uses. `ec923c5` trimmed the 6 tools whose description exceeded ~700 chars (cutting the
 * total from ~14.5KB to ~11.8KB); these thresholds keep that budget from silently regressing as
 * new tools are added or existing descriptions grow.
 */
const MAX_DESCRIPTION_CHARS = 700;
const MAX_TOTAL_DESCRIPTION_CHARS = 10_000;
const MAX_TOTAL_SCHEMA_CHARS = 24_000; // ~6K tokens — the payload size ec923c5 measured pre-trim

describe("TOOL_DEFINITIONS size budget", () => {
  test.each(TOOL_DEFINITIONS.map((tool) => ({ name: tool.name, description: tool.description })))(
    "$name description stays under the per-tool cap",
    ({ name, description }) => {
      expect(
        description.length,
        `"${name}"'s description is ${description.length} chars, over the ${MAX_DESCRIPTION_CHARS}-char cap. ` +
          `Trim it to a one-sentence summary and point to docs/mcp.md for detail, the way ec923c5 did.`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
    },
  );

  test("total description text across all tools stays under budget", () => {
    const total = TOOL_DEFINITIONS.reduce((sum, tool) => sum + tool.description.length, 0);
    expect(
      total,
      `Total tool description text is ${total} chars, over the ${MAX_TOTAL_DESCRIPTION_CHARS}-char budget. ` +
        `Every new/grown description adds to a payload sent on every session's ListTools call.`,
    ).toBeLessThanOrEqual(MAX_TOTAL_DESCRIPTION_CHARS);
  });

  test("full ListTools JSON payload stays under budget", () => {
    const total = JSON.stringify(TOOL_DEFINITIONS).length;
    expect(
      total,
      `Full TOOL_DEFINITIONS JSON is ${total} chars (~${Math.round(total / 4)} tokens), over the ` +
        `${MAX_TOTAL_SCHEMA_CHARS}-char budget. This includes param descriptions, not just top-level ones.`,
    ).toBeLessThanOrEqual(MAX_TOTAL_SCHEMA_CHARS);
  });
});
