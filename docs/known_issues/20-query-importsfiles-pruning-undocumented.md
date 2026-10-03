# Issue 20 — `query`'s `importsFiles`/`imports` co-membership pruning is undocumented and reads as a bug

Status: **open, docs-only fix**. Found independently by 3 of 4 audits in the same cross-language
session (TS/JS, JVM/Kotlin, Python), 2026-10-03.

## Symptom

The same file reports a different, often much shorter, `importsFiles` list from `query` depending
solely on what else is in the filtered result set — with no indication this is happening:

- TS/JS: `query({filter:"path:src/api/Folder.js"})` → `importsFiles: []` for a file with 7 real
  local imports (confirmed on disk). Widening to `query({filter:"category:logic,path:src/api"})`
  on the *same file* → 3 of those 7 (only the ones whose target also matched the broader filter).
  `get_dependencies` on the same file gives the correct, complete list of 7.
- Python: identical phenomenon reproduced on `src/flask/__init__.py` (visibly 10+ imports, `[]`
  under a narrow single-path filter) — and, to rule out a Python-specific cause, reproduced again
  on mokosh's own `src/config.ts` (TypeScript) in its own repo, confirming it's filter-mechanics,
  not language-specific.
- JVM/Kotlin: not separately re-confirmed as a distinct finding in that audit, but the same
  `filterGraph` code path applies to every language.

## Root cause

This is **intentional, working-as-coded** behavior, not a parsing bug — confirmed by the function's
own doc comment:

> `src/query/filter.ts:17` — "...then trims each node's import list to edges whose target is also
> in the result set."

`filterGraph`'s design trims each returned node's edge list to only the edges whose *target* also
survived the same filter, so a narrow `path:` filter matching one file naturally also narrows that
file's own reported imports down to (usually zero) matches. The behavior is correct per its design
intent (showing only edges *within the queried slice*) but is not surfaced anywhere a caller would
see it before being surprised by it:

- `docs/mcp.md` and `docs/query.md` describe `slim` only as "strips edge metadata," never
  mentioning that `imports`/`importsFiles` is filtered-result-set-relative rather than
  always-the-file's-true-complete-list.
- The MCP tool description for `query` (`src/mcp/tools.ts`) doesn't mention it either.

## Why this matters

An AI assistant (or a human) using `query` to answer "does file X import file Y?" on a filter
scoped to just file X gets a confident-looking, **false** "no" — the tool returns a valid-shaped
empty list, not an error or a caveat, so there's no signal to retry with `get_dependencies`
instead (which always returns the true, complete list for a single file and is the right tool for
this specific question).

## Fix (not started — documentation only, no code change needed)

1. Add a sentence to `docs/query.md` and `docs/mcp.md` next to the `imports`/`importsFiles` field
   description: something like *"an edge only appears here if its target file is also in this
   query's result set — for a single file's complete, untrimmed import list regardless of what
   else matched, use `get_dependencies` instead."*
2. Same sentence (or a shortened form) in `query`'s MCP tool description in `src/mcp/tools.ts`, so
   it's visible to an AI assistant without requiring a docs lookup.
3. Optional, bigger: consider whether a single-file (`path:` exact match, zero-or-one result)
   query should skip the trim entirely, since "trim to the result set" only makes semantic sense
   when the result set has more than one node — a one-node result set trimming a file's own edges
   against itself is close to always wrong to show as "this file's imports." Not required for the
   minimal doc fix above; flagged as a design question for whoever picks this up.

## Test plan (for whoever picks this up)

- No code behavior to test if only the doc fix ships. If the optional single-file-result
  skip-trim change (item 3) is taken: `src/query/filter.test.ts` — a `path:` filter matching
  exactly one node should return that node's complete, untrimmed `importsFiles`, matching
  `get_dependencies`'s output for the same file.

## Cross-issue dependencies

None. Independent documentation gap, surfaced incidentally by three unrelated per-language audits
hitting the same mechanism.
