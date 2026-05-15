#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp/server";

export { createMcpServer } from "./mcp/server";

/**
 * @description Bootstraps the MCP server by creating an instance and connecting
 *   it to the stdio transport, making all registered tools available to MCP-compatible clients.
 */
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
