# 04 — MCP tool registry (split `handlers.ts`)

## Problem
`src/mcp/handlers.ts` is 1691 lines with 26 `handle*` functions and 26 `*Args` interfaces *(verified)*.
`src/mcp/server.ts` imports 52 symbols from it; `tools.ts` (716 lines) holds the JSON Schemas
separately, and `tool-cli-parity.test.ts` exists to keep the two in sync by hand. `handleFindDuplicates`
has cognitive complexity 49.

## Pattern
**Command pattern + registry.** One module per tool:

```ts
export const getAffected: ToolModule<GetAffectedArgs> = {
  definition: { name, description, inputSchema },
  handle: async (args, ctx) => ...,
};
```

`src/mcp/tools/index.ts` exports `TOOLS: ToolModule[]`; `server.ts` builds the list handler and the
call dispatcher from it. Shared helpers (session lookup, package fan-out, root resolution,
`CONFIG_REQUIRED` responses) move to `src/mcp/tools/_shared.ts`.

## Steps
1. Introduce `ToolModule` and `ToolContext` types; no behavior change.
2. Migrate tools one at a time, smallest first, keeping `handlers.ts` re-exports until the last one.
3. Derive `TOOL_DEFINITIONS` from the registry; keep `tools.test.ts` green.
4. Make the CLI command list read the same definitions where a 1:1 tool exists (feeds part 08).
5. Delete `handlers.ts` once empty; update tests to import per-tool modules.

## Risks
Large diff; do it in small PRs. `handlers.test.ts` and `handlers-bounded-output.test.ts` import
handler names — keep a temporary barrel. Avoid circular imports through `_shared.ts`.

## Done when
No file in `src/mcp/` over ~400 lines, schema and handler live in the same file, and adding a tool
touches one new file plus the registry list.
