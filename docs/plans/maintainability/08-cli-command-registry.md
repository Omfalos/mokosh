# 08 — CLI command registry (split `runner.ts`)

## Problem *(verified)*
`src/cli/runner.ts` (428 lines) has 36 imports — the biggest hub in the repo. It imports every file
in `src/cli/commands/` and dispatches by flag. Individual commands are also heavy:
`cli/commands/find-duplicates.ts#run` scores cognitive complexity 30.

## Pattern
**Command registry.** `commands/index.ts` exports `COMMANDS: Command[]`, each
`{ flag, matches(args), run(ctx) }`. `runner.ts` finds the first match; it no longer imports commands
one by one. `resolveCommandHandler` (already exported) becomes a lookup.

If part 04 has landed, derive the shared command metadata (name, description, argument schema) from
the MCP tool definitions where a tool exists 1:1.

## Steps
1. Add the `Command` type and registry; keep the current handlers.
2. Move runner dispatch to the registry; delete the import list.
3. Split `find-duplicates.ts#run` into parse-args / run / format steps.
4. Keep `runner.test.ts` and `run.test.ts` green throughout.

## Risks
`--watch` handling (`cli/watch.ts`) and graph-loading order are cross-cutting; keep them in the
runner, not in commands.

## Done when
`runner.ts` imports fewer than ~12 modules and adding a command is one new file plus one registry
line.
