# 07 — Finish the language-adapter migration

## Problem
CLAUDE.md states: "tools never switch on `node.type`; add a `LanguageHooks` hook instead", and
adding a language still means editing `src/parser.ts` as well as the adapter.

## Evidence *(verified by grep for `.type === "` / `FileType.` outside `src/languages/`)*
Hits: `builder.ts` 3, `handlers.ts` 2, `enrichment.ts` 1, `features/index.ts` 1,
`style-blocks.ts` 1, `parser/style/*` 5, `parser/lang/*` (lua 15, markdown 2, java 1, ls 1).
Many of the `parser/lang/*` hits are probably AST node types and fine — **audit before acting**; the
ones that matter are in `builder.ts`, `handlers.ts`, `enrichment.ts`, `features/index.ts`.
`parser.ts` imports every language parser directly (21 imports).

## Approach
1. Classify each hit: AST node type (leave), file-type switch in a tool (migrate).
2. For each migrated one, add a `LanguageHooks` method and call it through
   `src/languages/dispatch.ts`.
3. Make adapters expose `parse(filePath, source)`; reduce `parser.ts` to
   `getAdapter(type).parse(...)` plus the style/markdown special cases.
4. Update the "Adding a new language" section of CLAUDE.md and `adr-022`.

## Files
`src/parser.ts`, `src/languages/{types,dispatch,registry}.ts`, `src/languages/adapters/*`,
`src/graph/builder.ts`, `src/graph/enrichment.ts`, `src/graph/features/index.ts`,
`src/mcp/handlers.ts`.

## Risks
Parser registration order and worker-thread loading (`parse-worker.ts`) — workers must still lazy
load only the parser they need.

## Done when
A grep for file-type switches outside `src/languages/` and `src/parser/` is empty, `parser.ts` has
fewer than ~8 imports, and a new language touches only its adapter, parser file, `FileType` and
`DEFAULT_EXTENSIONS`.
