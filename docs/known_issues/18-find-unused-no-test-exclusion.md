# Issue 18 — `find_unused` has no test-file exclusion via MCP; the CLI's own exclusion is JS-biased too

Status: **open, not started**. Found dogfooding v0.5.5 against a real Flask (Python) checkout,
2026-10-03.

## Symptom

`mcp__mokosh__find_unused` on a real Flask repo (`src/flask/` src-layout package, `tests/`
pytest directory) reported 63 "unused" files, including essentially every file under `tests/` —
`test_basic.py`, `test_appctx.py`, `conftest.py`, `tests/test_apps/**`, `tests/type_check/**` — all
legitimate, actively-used pytest files that are *never meant* to be imported by the package itself,
only discovered by the pytest runner at test time. A fair reading of "what's safe to delete" from
this tool is swamped by this false-positive noise for any pytest-style Python repo.

## Root cause

Confirmed by reading the code:

- `handleFindUnused` (`src/mcp/handlers.ts:591-629`) calls `graph.findUnusedFiles(allFiles)`
  **unconditionally** — there is no test-exclusion logic at all on the MCP path, and
  `FindUnusedArgs`'s schema has no `excludeTests` (or any filter/limit) option to opt into one.
- The CLI equivalent, `src/cli/commands/find-unused.ts`, *does* have an `--exclude-tests` /
  `ctx.excludeTests` option — but its own `isTestPath` (line 14) is a separate, ad hoc
  implementation with its own hardcoded, JS/TS-biased pattern list
  (`TEST_PATH_PATTERNS = [".test.", ".spec.", "-test.", "-spec.", ".stories."]`, line 6) — the
  exact same bias documented in [issue 17](17-test-pattern-registry-js-biased.md), duplicated a
  third time in a third place. `test_basic.py`'s basename matches none of these five substrings,
  so even passing `--exclude-tests` on the CLI for this repo would not have excluded it.
- Neither call site uses `looksLikeTestPath` (`src/languages/dispatch.ts`), the one
  implementation in the codebase that's actually per-language aware (dispatches to each adapter's
  `isTestPath` hook, e.g. Go's `_test.go` suffix) and that already exists for exactly this purpose.

## Why this is worse than it looks

`find_unused`'s whole value proposition is "tell me what's safe to delete." A Python-repo caller
(human or AI assistant) gets back a list that's majority false positives (real, in-use test files)
with no signal that anything was excluded or should have been — the response looks exactly as
confident and complete as a correct one. The CLI's existing `--exclude-tests` flag gives a false
sense that this is already handled for every language, when in practice it was only ever verified
against JS/TS naming.

## Fix (not started)

1. Wire `looksLikeTestPath` (or each node's own `category === "test"`, which is already computed
   correctly and independently per [issue 17](17-test-pattern-registry-js-biased.md)'s notes on
   Python) into `handleFindUnused`, gated behind a new `excludeTests` MCP arg mirroring the CLI's.
2. Replace `src/cli/commands/find-unused.ts`'s standalone `isTestPath`/`TEST_PATH_PATTERNS` with a
   call to the same shared per-language-aware helper, removing the third duplicate implementation.
3. Separately (smaller, noted by the same audit): `find_unused`'s MCP schema has no `limit` or
   `package` scoping the way `query`/`find_duplicates` do — on a large monorepo an unfiltered
   result can't be paged or narrowed from the tool side at all (observed: 230KB uncapped on a
   ~600-node single-entry-point Kotlin graph in the same audit session). Worth a `limit`/`path`
   filter arg as a follow-up, not blocking the test-exclusion fix above.

## Test plan (for whoever picks this up)

- `src/mcp/handlers.test.ts`: `find_unused` with `excludeTests: true` on a fixture with a
  `test_*.py` file and a real `.test.ts` file — both excluded.
- `src/cli/commands/find-unused.test.ts` (if it exists) updated for the shared helper; same
  Python-convention case added.
- Regression: existing JS/TS `--exclude-tests` behavior unchanged.

## Cross-issue dependencies

- Shares its root cause with [issue 17](17-test-pattern-registry-js-biased.md) — see that issue's
  write-up for the full "three separate, inconsistent implementations" picture.
