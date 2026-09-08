# Issue 6 — `find_duplicates` output is too large for an LLM to consume; needs a query layer

Status: **6a–6c shipped** (2026-09-08). Found dogfooding v0.5.0 (2026-09-03).

## Shipped

- **6a — query DSL.** `src/query/dup-parser.ts` (`parseDupQuery` → `DuplicateQuery`) + `src/query/dup-filter.ts`
  (`matchDupGroup` predicate, `sortLimitDupGroups`, `applyDupQuery`), table-driven like
  `src/query/parser.ts`. Keys: `path` / `path:!`, `allPaths`, `family`, `type`, `kind`,
  `defKind`, `minLines`/`maxLines`, `minScore`/`maxScore`, `minOccurrences`, `crossFile:<bool>`,
  `signal:<name>` / `signal:!<name>` (repeatable), `sort:<lines|score|occurrences>`, `sortDir`,
  `limit`. Unknown keys / malformed clauses **throw** (deliberately louder than the node DSL).
  `crossPackage` was **dropped**: `find_duplicates` scans each package independently, so a group
  never spans packages — the key would always be false. Wired as `filter` on the MCP tool and
  `--dup-query` on the CLI; `findDuplicates()` gained a `filter?: string` option that applies the
  predicate *before* clustering so `clusters` narrow with `groups`; `sort`/`limit` from the DSL
  are applied by the caller after the per-package merge.
- **6b — slim mode.** `slim` (default **true**) on the MCP tool and the CLI (`--dup-full` opts
  out). Slim group: `{ lines, score?, family?, kind?, defKind?, signals?, occurrences:
  ["path:start-end"] }`; slim cluster drops the nested member-group bodies. Shared shaping
  helpers in `src/graph/duplication/shape.ts` (`slimDupGroup`, `slimDupCluster`,
  `summarizeDuplicates`) so MCP and CLI render identically.
- **6c — summary-first response.** Every response leads with
  `summary: { matched, byFamily, byTopDir, bySignal, largestLines }`, computed over the whole
  post-`filter`, pre-`limit` set.

## Not done

- **6d — fold into a shared `src/query/` result-shaping layer** for node-results and
  `get_module_responsibility` too. Deferred; `find_duplicates` has its own `filter`/`slim`/
  `summary` path for now.
- The **overlapping-window explosion** below is a matcher fix, tracked separately in
  `docs/plans/duplication-noise-reduction.md` (items A/E) — the query layer mitigates it
  (`signal:!same-file` drops the whole cluster) but doesn't resolve it.

---

## Original write-up

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
| `signal:<name>` / `signal:!<name>` | has / lacks a signal from [issue 5](05-find-duplicates-and-cycles-noise.md) (shipped: `same-file`, `generated`; issue 7 may add more) |
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

## Related — overlapping-window explosion (needs a matcher fix, not just a query layer)

Dogfooding on box-ui-elements, and reproduced locally on the issue-5 branch: a single
self-similar (periodic) region — a uniform `key: value` list like `test/fixtures/theme/colors.js`
— explodes into ~N near-identical `DuplicateGroup`s, one per phase offset of the repeating unit.
An 80-entry list produced **37 groups**: `colors.js:2-41 / 42-81`, then `2-40 / 41-79`, then
`2-39 / 40-77`, … each one row shorter. `dropSelfOverlaps` (`suffix-duplicates.ts`) collapses
overlapping occurrences *within one LCP interval*, and the exact-shared-occurrence clustering
merges pair-explosion, but neither dedupes *distinct intervals that describe the same finding at
a different offset*.

A `filter` / `slim` / `summary` layer alone doesn't fix this — `limit` would just return the
top few of the 37, all describing one region, crowding out real hits. The matcher itself should
collapse groups whose occurrence spans (per file-set) are near-super/subsets of another's,
keeping the max span — or detect the periodicity and emit one group. Worth folding into 6c or
splitting into its own issue. Mitigation available today: every one of these carries
`signals: ["same-file"]`, so a consumer filtering `signal:!same-file` drops the whole cluster.

## Dependencies

6a's `signal:` key depends on [issue 5](05-find-duplicates-and-cycles-noise.md)'s
`DuplicateGroup.signals`. `crossPackage` depends on the workspace graph being available
(issues 1 & 2, fixed in #12). Otherwise independent.
