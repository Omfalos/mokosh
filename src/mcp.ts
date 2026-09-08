#!/usr/bin/env node
/** MCP server entry point: bootstraps the server and connects it to the stdio transport. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp/server";

export { createMcpServer } from "./mcp/server";

/** `true` only when this module is the process entry point (`node dist/mcp.js`, or the
 *  `mokosh-mcp` bin symlink), not when it is imported for its `createMcpServer` re-export (tests,
 *  library use). Gates every side effect below — importing this file must not re-exec or connect
 *  a transport. Compares realpaths so a relative `argv[1]` (`.mcp.json` passes `"dist/mcp.js"`)
 *  or a `node_modules/.bin` symlink still matches. `__filename` is native in the CJS bundle and
 *  provided by tsup `shims` in the ESM one. */
const IS_ENTRYPOINT = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return fs.realpathSync(path.resolve(argv1)) === fs.realpathSync(__filename);
  } catch {
    return false;
  }
})();

/** Heap headroom (MiB) the server wants. Building a large monorepo's workspace graph and running
 *  `find_duplicates` over it can transiently need well over Node's default old-space size; the
 *  previous behaviour was a silent OOM abort that the client only saw as "Connection closed". */
const DESIRED_HEAP_MB = 4096;

/**
 * @description If the current V8 heap limit is below {@link DESIRED_HEAP_MB} and we have not
 *   already re-spawned once, re-exec this same script as a child with
 *   `--max-old-space-size` raised via `NODE_OPTIONS` (so piscina parse/tokenize workers inherit
 *   it too), forwarding stdio untouched so the JSON-RPC pipe is transparent. Returns `true` when
 *   it re-spawned (the caller should not continue), `false` when the current process should run
 *   the server itself.
 */
function reExecWithHeadroomIfNeeded(): boolean {
  if (process.env.MOKOSH_MCP_CHILD === "1") return false;
  const heapLimitMb = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
  if (heapLimitMb >= DESIRED_HEAP_MB) return false;

  const scriptPath = process.argv[1];
  if (!scriptPath) return false;

  const nodeOptions =
    `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${DESIRED_HEAP_MB}`.trim();
  const result = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, MOKOSH_MCP_CHILD: "1", NODE_OPTIONS: nodeOptions },
  });
  // Couldn't spawn at all — fall through and run the server in this process rather than exit.
  if (result.error) {
    logFatal("re-exec", result.error);
    return false;
  }
  process.exit(result.status ?? (result.signal ? 1 : 0));
}

/** Log a fatal reason to stderr (visible in the MCP client's server logs) before exiting, so a
 *  crash is diagnosable instead of a bare "Connection closed". */
function logFatal(kind: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[mokosh-mcp] FATAL ${kind}: ${detail}\n`);
}

/**
 * @description Bootstraps the MCP server by creating an instance and connecting
 *   it to the stdio transport, making all registered tools available to MCP-compatible clients.
 */
async function main() {
  process.on("uncaughtException", (err) => {
    logFatal("uncaughtException", err);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logFatal("unhandledRejection", reason);
    process.exit(1);
  });

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (IS_ENTRYPOINT && !reExecWithHeadroomIfNeeded()) {
  main().catch((err) => {
    logFatal("startup", err);
    process.exit(1);
  });
}
