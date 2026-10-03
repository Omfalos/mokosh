# Issue 17 — The core test-file discovery registry is JS/TS-biased and misses Go/Python conventions

Status: **open, not started**. Found dogfooding v0.5.5 against gin-gonic/gin (Go) and, by code
inspection, confirmed latent for Python too, 2026-10-03.

## Symptom

`_test.go` files never become graph nodes through `mcp__mokosh__query`/`get_affected`/
`get_call_graph`, under any entry-point configuration tried, on a real gin-gonic/gin checkout:

- `query(filter:"category:test")` → empty result, on both a 33-node auto-detected graph and a
  66-node graph built from 19 explicit non-test entry points covering the whole `gin` package.
- `query(filter:"path:_test")` → empty, same two graphs.
- `languageCoverage` for `type:"go"` never reports a nonzero test `fileCount`.
- Yet `find_unused` (which does its own independent disk scan — see
  [issue 18](18-find-unused-no-test-exclusion.md)) correctly lists all 40 real `_test.go` files by
  path — proving they genuinely exist on disk and mokosh's own file-scanning code can see them;
  they are specifically never added to the **graph**.

This contrasts with markdown docs, which this same build correctly discovers and adds as 9
`other`-category nodes — the gap is specific to Go's test-file convention, not a general "no
discovery pass ran" failure.

## Root cause

Confirmed by reading the code, not just observed behavior. Two **independent, inconsistent**
"is this a test file" implementations exist in the codebase:

1. **The newer, per-language-aware one**: `src/languages/dispatch.ts`'s `looksLikeTestPath` +
   each language adapter's own `hooks.isTestPath`. Go's adapter (`src/languages/hooks/go.ts:6`)
   correctly declares `isTestPath: (relPath) => relPath.endsWith("_test.go")`.
2. **The older substring-pattern registry actually used for file discovery**:
   `src/parser/classify.ts:64`'s `builtinTestPatterns = [".test.", ".spec.", "-test.", "-spec."]`,
   consumed by `src/graph/builder.ts`'s `processTestFiles` (line ~334-337:
   `patterns.some((pattern) => entry.name.includes(pattern))`) — the exact pass responsible for
   discovering test files when real entry points are given (test files are never reachable via
   imports from source code, so this separate walk is how they enter the graph at all, per the
   function's own doc comment).

`_test.go`'s basename (e.g. `context_test.go`) contains none of `.test.`, `.spec.`, `-test.`,
`-spec.` — underscore, not a dot or hyphen, precedes "test" — so `processTestFiles`'s `matchesTest`
predicate never matches it, and Go test files are silently skipped by the one pass that exists
specifically to discover test files for a non-empty-entry-points build. **The already-correct
`GO_HOOKS.isTestPath` hook is never consulted here at all** — `builder.ts` doesn't call
`looksLikeTestPath` or any per-language hook anywhere in `processTestFiles`/`processAllSourceFiles`.

Python's `test_*.py` prefix convention (no language adapter `isTestPath` hook exists for Python at
all, confirmed — `src/languages/hooks/python.ts` only implements `entryPoints`) would hit the
identical gap the moment Python is analyzed with **explicit** entry points. It happened not to
surface in this session's Python audit only because that run used `entryPoints: []`, which takes
the different `processAllSourceFiles` code path (`src/graph/builder.ts:314-323`) — and that path's
own test-pattern check *also* fails to match `test_basic.py` against the same four substrings, so
such files are simply never excluded from the "discover everything" walk and end up in the graph
as ordinary (if correctly `category: "test"`-tagged, via a separate, broader classification check)
nodes — a different, accidentally-benign path through the same underlying gap, not a real fix.

## Fix (not started)

`processTestFiles`/`processAllSourceFiles` in `src/graph/builder.ts` should consult
`looksLikeTestPath` (`src/languages/dispatch.ts`) — which already correctly dispatches to each
language's own `isTestPath` hook plus the generic directory/suffix heuristics — instead of, or in
addition to, the older `getTestPatterns()` substring list from `src/parser/classify.ts`. This also
requires adding an `isTestPath` hook for Python (`test_*.py` / `*_test.py` / `conftest.py`) and
auditing the other language adapters in `src/languages/hooks/` for the same gap.

## Test plan (for whoever picks this up)

- `src/graph/builder.test.ts` (or wherever `processTestFiles` is tested): a Go fixture with a
  `*_test.go` file and **no** entry point reaching it by import — assert it becomes a graph node
  with `category: "test"` after a build with explicit (non-empty) entry points.
- Same for a Python `test_*.py` fixture, after adding the Python `isTestPath` hook.
- Regression: existing JS/TS `.test.`/`.spec.` fixtures still discovered (no regression from
  switching the discovery predicate).

## Cross-issue dependencies

- Shares its root cause with [issue 18](18-find-unused-no-test-exclusion.md) — both exist because
  the codebase has two separate, out-of-sync "is this a test file" implementations
  (`src/parser/classify.ts`'s substring registry vs. `src/languages/dispatch.ts`'s per-language hook
  system), and different call sites each picked a different one, or none.
- Is part of the same umbrella as [issue 8](08-cross-language-reliability.md) (feature parity
  across languages) — this is a category-accuracy/discovery gap specifically for Go and (latently)
  Python, not yet called out in `docs/language-support.md`.
