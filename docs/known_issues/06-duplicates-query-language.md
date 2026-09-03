# Issue 6 — `find_duplicates` output is too large for an LLM to consume; needs a query layer

Status: proposed, not started. Found dogfooding v0.5.0 (2026-09-03).

## Symptom

On a real repo, `find_duplicates` returns dozens of groups, each with every occurrence's
file + line range + (implicitly) the duplicated span. An LLM caller has to read the whole
payload to find the few groups it cares about ("duplicates inside `src/payments/`", "only
cross-package ones", "only TypeScript, excluding tests"). There is no server-side filter — the
only knobs are `minLines`, `windowSize`, `ignoreLiterals`, `maxPunctuationRatio`, `limit`
(`src/graph/duplication/index.ts`, `FindDuplicatesOptions`). `limit` just truncates
largest-first; it can't *select*.

The graph `query` tool already solved this shape for nodes with a `key:value` DSL
(`src/query/parser.ts`, `src/query/filter.ts`, `NodeQuery` in `src/query/types.ts`). Duplicate
results have no equivalent.

## Root cause

`FindDuplicatesResult` is a flat `groups: DuplicateGroup[]` with no query/projection layer.
`DuplicateGroup` (`src/graph/duplication/suffix-duplicates.ts` / `shingle.ts`) carries
`lines`, `family`, and `occurrences[]` (`{ file, startLine, endLine }`) — enough to filter on,
but nothing does.

## Fix plan

### 6a — a duplicate-results query DSL

Add a `filter` string param to `find_duplicates` (and the CLI command), parsed by a new
`src/query/dup-parser.ts` mirroring `src/query/parser.ts`'s table-driven design. Proposed keys:

| Key | Meaning |
|---|---|
| `path:<substr>` / `path:!<substr>` | at least one / no occurrence under this path |
| `allPaths:<substr>` | *every* occurrence under this path (within-module dup) |
| `family:<code\|style>` | duplicate family |
| `type:<lang>` | occurrences are of this `FileType` |
| `minLines:<N>` / `maxLines:<N>` | block size |
| `minOccurrences:<N>` | repeated at least N times |
| `crossFile:<bool>` | occurrences span ≥2 files |
| `crossPackage:<bool>` | occurrences span ≥2 workspace packages |
| `signal:<name>` / `signal:!<name>` | has / lacks a signal from [issue 5](05-find-duplicates-and-cycles-noise.md) (`mostly-accessors`, `contains-imports`, `generated`, …) |
| `sort:<lines\|occurrences>` `sortDir:<asc\|desc>` | ordering |
| `limit:<N>` | cap |

### 6b — projection / slim mode

Mirror `query`'s `slim` default. A `slim` (default true) `find_duplicates` response returns
per group: `{ lines, family, occurrences: ["path:start-end", …], signals }` — no repeated
source text, no token counts. `slim: false` adds the duplicated snippet and per-occurrence
metadata. Add a `fields` allow-list for explicit projection.

### 6c — summary-first response

Add a `summary` block to the response: total groups, groups by family, groups by top-level
directory, largest group size, count filtered out. An LLM reads the summary, then issues a
targeted `filter` call — never needing the full list.

### 6d — reuse for the graph itself

The same "output too large" problem exists for `query` with no filter and for
`get_module_responsibility` with no `paths`. Fold this work into a shared
`src/query/` result-shaping layer so duplicate-results, node-results, and responsibility
results all support `filter` + `slim` + `summary` consistently. (`src/graph/queries.ts`
already centralizes node/dep shaping — extend it.)

## Expected outcome

- `find_duplicates({ filter: "crossPackage:true,type:typescript,path:!test", slim: true })`
  returns a short, directly-actionable list.
- Default call leads with a summary an LLM can triage in one read.

## Test plan

- Unit (`src/query/dup-parser` test): every key parses; negation; invalid key errors.
- Unit (`src/graph/duplication/index.test.ts`): `filter` narrows a known fixture result set
  correctly for each key; `slim` shape; `summary` counts.
- Unit: `crossPackage` uses the `WorkspaceGraph` package map; is a no-op (all false) for a
  single-package graph.
- Integration: CLI `mokosh --find-duplicates --dup-query "..."` parity with the MCP tool
  (extend `src/mcp/tool-cli-parity.test.ts`).
- Regression: no `filter` → same groups as today (order preserved).

## Files touched

new `src/query/dup-parser.ts` + `src/query/dup-filter.ts`, `src/query/types.ts`,
`src/graph/duplication/index.ts`, `src/graph/queries.ts`, `src/mcp/tools.ts`,
`src/mcp/handlers.ts`, `src/cli/commands/find-duplicates.ts`, `src/cli/args.ts`,
`docs/mcp.md`, `docs/query.md`.

## Dependencies

6a's `signal:` key depends on [issue 5](05-find-duplicates-and-cycles-noise.md)'s
`DuplicateGroup.signals`. `crossPackage` depends on the workspace graph being available
([issues 1 & 2](01-monorepo-workspace-packages-timeout.md)). Otherwise independent.
