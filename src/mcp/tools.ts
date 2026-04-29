/**
 * MCP tool schema definitions for the mokosh server.
 *
 * Each entry is a complete JSON Schema description of one callable tool.
 * This list is returned verbatim by the `ListTools` request handler and
 * drives IDE/agent autocompletion for tool arguments.
 *
 * Tool call order requirement: `analyze` must be called first to populate the
 * in-session graph cache. All other tools except `find_unused` and `query`
 * require a prior `analyze` call for the same `root`.
 */
export const TOOL_DEFINITIONS = [
  {
    name: "analyze",
    description:
      "Build the dependency graph for a project from entry points. Returns a summary of node count, categories, and cycles. Must be called before get_dependencies, get_dependents, get_affected, or propose_tags.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Absolute path to the project root" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description: "Entry point files relative to root (e.g. ['src/index.ts'])",
        },
      },
      required: ["root", "entryPoints"],
    },
  },
  {
    name: "get_dependencies",
    description:
      "Get files that a given file imports (outgoing traversal). depth=1 returns immediate imports; omit for the full transitive tree.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
        depth: { type: "number", description: "Max traversal depth (default: 1)" },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_dependents",
    description: "Get files that directly import a given file (one-hop incoming edges).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "get_affected",
    description:
      "Get all files transitively affected if a given file changes — full incoming traversal upward. Use before a refactor to understand blast radius. Set testsOnly=true to get only test files.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        file: { type: "string", description: "File path relative to root" },
        testsOnly: {
          type: "boolean",
          description: "Return only test/spec files (default: false)",
        },
      },
      required: ["root", "file"],
    },
  },
  {
    name: "find_unused",
    description:
      "Find files in the project that are not reachable from any entry point. Useful before cleanup passes.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: { type: "array", items: { type: "string" } },
      },
      required: ["root", "entryPoints"],
    },
  },
  {
    name: "propose_tags",
    description:
      "Propose test tags to run based on changed files. Pass changedFiles explicitly or omit to use git diff. Returns tags that cover all affected tests.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Changed files relative to root. Omit to read from git diff.",
        },
        featureThreshold: {
          type: "number",
          description:
            "Min importers for a file to be treated as a feature hub (default: 5). A hub short-circuits traversal and emits a feature:<name> tag instead of all downstream tags.",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "propose_affected_tests",
    description:
      "Return the file paths of test files affected by changed files. Pass changedFiles explicitly or omit to use git diff. Output is a list of paths ready to pass directly to a test runner (e.g. vitest). Feature hubs act as traversal boundaries — tests beyond a hub are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Changed files relative to root. Omit to read from git diff.",
        },
        featureThreshold: {
          type: "number",
          description: "Min importers for a file to be treated as a feature hub (default: 5).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "detect_features",
    description:
      "Identify feature hub files — non-test files imported by many others. Returns a list sorted by in-degree descending.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description: "Entry point files relative to root. Omit to use the cached graph.",
        },
        featureThreshold: {
          type: "number",
          description: "Min importers to qualify as a feature hub (default: 5).",
        },
      },
      required: ["root"],
    },
  },
  {
    name: "query",
    description:
      "Filter the graph by category, tag, or path. Returns matching nodes as JSON or a Mermaid diagram. If entryPoints is omitted the cached graph from a prior 'analyze' call is used.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string" },
        entryPoints: {
          type: "array",
          items: { type: "string" },
          description:
            "Entry points to build the graph. Omit to reuse the cached graph from a prior 'analyze' call.",
        },
        filter: {
          type: "string",
          description: "Query string e.g. 'category:logic' or 'category:logic,tag:auth'",
        },
        mermaid: { type: "boolean", description: "Return a Mermaid diagram (default: false)" },
      },
      required: ["root", "filter"],
    },
  },
] as const;
