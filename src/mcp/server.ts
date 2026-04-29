import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionState } from "./cache";
import {
  handleAnalyze,
  handleDetectFeatures,
  handleFindUnused,
  handleGetAffected,
  handleGetDependencies,
  handleGetDependents,
  handleProposeAffectedTests,
  handleProposeTags,
  handleQuery,
} from "./handlers";
import { TOOL_DEFINITIONS } from "./tools";
import { validateRoot } from "./utils";

/**
 * Creates and wires up the mokosh MCP server.
 *
 * Each call returns a fresh `Server` instance backed by its own `SessionState`,
 * so multiple instances (e.g. parallel test runs) are fully isolated from one
 * another. Session state persists across tool calls, meaning `analyze` only
 * needs to run once per project root.
 *
 * Every incoming tool call is validated at the dispatch layer: if the request
 * includes a `root` argument it must be an absolute path within the user's home
 * directory. Handlers therefore never receive an out-of-bounds root.
 *
 * @returns A configured MCP `Server` ready to be connected to a transport.
 *
 * @example
 * ```ts
 * import { createMcpServer } from './mcp/server';
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *
 * const server = createMcpServer();
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createMcpServer(): Server {
  const cache = new SessionState();

  const server = new Server({ name: "mokosh", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // biome-ignore lint/suspicious/noExplicitAny: args are validated by the MCP SDK against the schemas in TOOL_DEFINITIONS
      const a = args as any;
      if (a?.root !== undefined) validateRoot(a.root);
      switch (name) {
        case "analyze":
          return await handleAnalyze(cache, a);
        case "get_dependencies":
          return handleGetDependencies(cache, a);
        case "get_dependents":
          return handleGetDependents(cache, a);
        case "get_affected":
          return handleGetAffected(cache, a);
        case "find_unused":
          return await handleFindUnused(cache, a);
        case "propose_tags":
          return handleProposeTags(cache, a);
        case "propose_affected_tests":
          return handleProposeAffectedTests(cache, a);
        case "detect_features":
          return await handleDetectFeatures(cache, a);
        case "query":
          return await handleQuery(cache, a);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
        ],
        isError: true,
      };
    }
  });

  return server;
}
