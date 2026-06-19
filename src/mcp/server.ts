/** Creates and configures the MCP server, wiring all tool handlers to their JSON Schema definitions. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { SessionState } from "./cache";
import {
  type AnalyzeArgs,
  type ClearCacheArgs,
  type DetectFeaturesArgs,
  type FindUncoveredArgs,
  type FindUnusedArgs,
  type GetAffectedArgs,
  type GetApiSurfaceArgs,
  type GetCallersArgs,
  type GetCallGraphArgs,
  type GetDependenciesArgs,
  type GetDependentsArgs,
  type GetFeatureGraphArgs,
  type GetModuleResponsibilityArgs,
  type GetTypeGraphArgs,
  type GetWorkspaceAffectedArgs,
  type GetWorkspacePackagesArgs,
  handleAnalyze,
  handleClearCache,
  handleDetectFeatures,
  handleFindUncovered,
  handleFindUnused,
  handleGetAffected,
  handleGetApiSurface,
  handleGetCallers,
  handleGetCallGraph,
  handleGetDependencies,
  handleGetDependents,
  handleGetFeatureGraph,
  handleGetModuleResponsibility,
  handleGetTypeGraph,
  handleGetWorkspaceAffected,
  handleGetWorkspacePackages,
  handleProposeTags,
  handleQuery,
  type ProposeTagsArgs,
  type QueryArgs,
  type ToolArgs,
} from "./handlers";
import { TOOL_DEFINITIONS } from "./tools";
import { type TextResponse, validateRoot } from "./utils";

/**
 * @description Creates and wires up the mokosh MCP server. Each call returns a fresh `Server`
 *   instance backed by its own `SessionState`, so multiple instances (e.g. parallel test runs)
 *   are fully isolated. Every incoming `root` argument is validated to be within the user's home
 *   directory before any handler runs.
 * @returns {Server} A configured MCP `Server` ready to be connected to a transport.
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

    const dispatch: Record<string, (args: ToolArgs) => Promise<TextResponse> | TextResponse> = {
      analyze: (args) => handleAnalyze(cache, args as AnalyzeArgs),
      get_dependencies: (args) => handleGetDependencies(cache, args as GetDependenciesArgs),
      get_dependents: (args) => handleGetDependents(cache, args as GetDependentsArgs),
      get_affected: (args) => handleGetAffected(cache, args as GetAffectedArgs),
      get_callers: (args) => handleGetCallers(cache, args as GetCallersArgs),
      find_unused: (args) => handleFindUnused(cache, args as FindUnusedArgs),
      find_uncovered: (args) => handleFindUncovered(cache, args as FindUncoveredArgs),
      propose_tags: (args) => handleProposeTags(cache, args as ProposeTagsArgs),
      detect_features: (args) => handleDetectFeatures(cache, args as DetectFeaturesArgs),
      get_type_graph: (args) => handleGetTypeGraph(cache, args as GetTypeGraphArgs),
      get_module_responsibility: (args) =>
        handleGetModuleResponsibility(cache, args as GetModuleResponsibilityArgs),
      get_feature_graph: (args) => handleGetFeatureGraph(cache, args as GetFeatureGraphArgs),
      get_call_graph: (args) => handleGetCallGraph(cache, args as GetCallGraphArgs),
      get_api_surface: (args) => handleGetApiSurface(cache, args as GetApiSurfaceArgs),
      query: (args) => handleQuery(cache, args as QueryArgs),
      get_workspace_packages: (args) =>
        handleGetWorkspacePackages(cache, args as GetWorkspacePackagesArgs),
      get_workspace_affected: (args) =>
        handleGetWorkspaceAffected(cache, args as GetWorkspaceAffectedArgs),
      clear_cache: (args) => handleClearCache(cache, args as ClearCacheArgs),
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
