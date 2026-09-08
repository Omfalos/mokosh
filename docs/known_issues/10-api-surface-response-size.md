# Issue 10 — `get_api_surface` returns a ~14K-token payload on a single-package repo; `unreachableFromEntry` is misleading

Status: **shipped** (2026-09-08). Found dogfooding v0.5.1 against mokosh itself.

## Symptom

`get_api_surface` on a plain (non-monorepo) root returns the entire `ApiSurface` object
verbatim over MCP:

- `publicExports` — ~200 entries for mokosh, each `{ name, definedIn, kind, doc?, signature? }`
- `internalFiles` — ~135 full paths
- `unreachableFromEntry` — ~114 full paths
- `testFiles` — 137 full paths

Measured: **~57 KB / ~14K tokens** for one tool call. The monorepo branch was already given a
compact per-package breakdown (`maxExportsPerPackage`, counts-only, name+kind); the plain-root
branch never got the same treatment.

Two things compound it:

1. **`unreachableFromEntry` is wrong for repos that ship CLIs.** `detectAllEntryPoints`
   (`src/graph/api-surface.ts`) read only `package.json` `exports` / `main` / `module`. It
   ignored `bin`. On mokosh the sole auto-detected entry point was `src/index.ts`, so every
   file reachable only through `src/cli/**` / `src/mcp/**` (100+ files) was reported as
   `unreachableFromEntry` — which the docs frame as "separate consumers … or dead code". They
   are the CLI and MCP entry points.
2. **`testFiles` is near-zero signal** — always "every unreachable test file", all token cost.

## Root cause

- `handleGetApiSurface` plain-root branch (`src/mcp/handlers.ts`) did
  `text({ ...surface, ...echoEntryPoints(surface.entryPoints) })` — no projection, no caps.
- `detectAllEntryPoints` had no `bin` handling.

## Fix

1. **`bin` as an entry-point source** — `src/graph/api-surface.ts`, `detectAllEntryPoints`:
   after the `exports` block, resolve `pkg.bin` (string or `Record<string,string>`) through the
   existing `tryResolveSrcEquiv` (`dist/foo.js` → `src/foo.ts`) and append. Additive to
   `exports`, listed after it so `found[0]` stays the library root. The `main`/`module` and
   `src/index.*` guesses stay gated on nothing else being found. Effect on mokosh:
   `unreachableFromEntry` drops from ~56 (CLI-config'd) / ~114 (exports-only) to a handful of
   genuinely standalone `.md` files.

2. **Summary-first single-surface response** — new
   `ApiSurfaceSummary` + `summarizeApiSurface(surface, { maxExports?, maxUnreachable? })` in
   `src/graph/api-surface.ts` (both re-exported from `src/index.ts`). Replaces every unbounded
   list with a count; keeps a capped `{ name, kind }` `publicExports` sample + a `byKind`
   histogram; keeps the (now short) `unreachableFromEntry` list, capped at 50. `handleGetApiSurface`
   gains `view: "summary" | "exports" | "full"` (default `"summary"`) and `maxExports`
   (default 30), applied by a shared `renderSurface()` on both the plain-root and
   single-`package` branches:
   - `"summary"` → `summarizeApiSurface(...)` — ~1K tokens on mokosh (was ~14K)
   - `"exports"` → summary + full `publicExports[]` (`definedIn` / `doc` / `signature`)
   - `"full"` → the complete `ApiSurface` + every path list (the pre-0.6 payload; back-compat)

   The multi-package monorepo breakdown is untouched — already compact, still keyed by
   `maxExportsPerPackage`.

3. **CLI unchanged** (`src/cli/commands/api-surface.ts`) — still prints the full
   `JSON.stringify(surface)`. CLI output is piped to files / `jq`, not a token budget; it just
   benefits from fix 1.

## Test plan

- `src/graph/api-surface.test.ts`: `detectAllEntryPoints` picks up object `bin` (after
  `exports`) and string `bin` (used even with no `exports`); a `bin` target absent from the
  graph is ignored. `summarizeApiSurface`: counts replace lists, export sample + `byKind` caps,
  `unreachableFromEntry` list kept but capped, `maxExports: Infinity` keeps all names, small
  surface sets no truncation flags.
- `src/mcp/handlers.test.ts` — `handleGetApiSurface (plain root)`: default is a summary (no
  `internalFiles` / `testFiles` arrays; has `*Count` + `byKind` + `hint`); `maxExports` caps
  the sample; `view: "exports"` adds full `publicExports` with `definedIn`; `view: "full"`
  returns every path list. Monorepo single-`package` now returns a summary by default,
  `view: "full"` restores the full surface.
- Manual: `analyze` then `get_api_surface` on the mokosh root → ~1K tokens; `view: "full"`
  reproduces the old payload.

## Cross-issue dependencies

None. The `view` param mirrors `find_duplicates`' `view: "summary" | "groups" | "full"`
(issue 6) but shares no code.
