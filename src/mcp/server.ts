import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionState } from "./cache";
import {
  type AnalyzeArgs,
  type DetectFeaturesArgs,
  type FindUnusedArgs,
  type GetAffectedArgs,
  type GetDependenciesArgs,
  type GetDependentsArgs,
  handleAnalyze,
  handleDetectFeatures,
  handleFindUnused,
  handleGetAffected,
  handleGetDependencies,
  handleGetDependents,
  handleProposeAffectedTests,
  handleProposeTags,
  handleQuery,
  type ProposeAffectedTestsArgs,
  type ProposeTagsArgs,
  type QueryArgs,
  type ToolArgs,
} from "./handlers";
import { TOOL_DEFINITIONS } from "./tools";
import { type TextResponse, validateRoot } from "./utils";

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

  const server = new Server({ name: "mokosh", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    const toolArgs = rawArgs as unknown as ToolArgs;

    // biome-ignore lint/suspicious/noExplicitAny: dispatch map holds heterogeneous handler return types
    const dispatch: Record<string, (args: ToolArgs) => Promise<TextResponse> | TextResponse> = {
      analyze: (args) => handleAnalyze(cache, args as AnalyzeArgs),
      get_dependencies: (args) => handleGetDependencies(cache, args as GetDependenciesArgs),
      get_dependents: (args) => handleGetDependents(cache, args as GetDependentsArgs),
      get_affected: (args) => handleGetAffected(cache, args as GetAffectedArgs),
      find_unused: (args) => handleFindUnused(cache, args as FindUnusedArgs),
      propose_tags: (args) => handleProposeTags(cache, args as ProposeTagsArgs),
      propose_affected_tests: (args) =>
        handleProposeAffectedTests(cache, args as ProposeAffectedTestsArgs),
      detect_features: (args) => handleDetectFeatures(cache, args as DetectFeaturesArgs),
      query: (args) => handleQuery(cache, args as QueryArgs),
    };

    const handler = dispatch[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);

    try {
      validateRoot(toolArgs.root);
      return await handler(toolArgs);
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
