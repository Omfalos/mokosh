/** Shared fs.watch ignore pattern, used by both the MCP session cache and the CLI's --watch mode. */
export const IGNORE_WATCH = /(?:^|[/\\])(?:node_modules|\.git|dist|build|coverage)(?:[/\\]|$)/;
