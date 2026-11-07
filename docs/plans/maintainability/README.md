# Maintainability plan — index

Status: **proposal, nothing implemented**. Source: a dogfooding run of every mokosh tool on this
repo (branch `feat/mcp-bounded-tool-output`, 2026-11-07). Items marked *(verified)* come straight
from tool output; the rest are hypotheses to confirm before work starts.

Work the parts **in order**. Each file is self-contained: problem, evidence, approach, files,
risks, done-when. Per project convention, write a short plan (files + approach + perf cost) and get
approval before editing.

| # | Part | Kind | Size | Depends on |
|---|------|------|------|------------|
| 01 | [Exclude worktrees / nested repos from discovery](01-exclude-worktrees.md) | bug | S | — |
| 02 | [Tool correctness bugs](02-tool-bugs.md) | bug | S–M | 01 |
| 03 | [`find_duplicates` output diet](03-find-duplicates-output.md) | tokens | M | 01 |
| 04 | [MCP tool registry (split `handlers.ts`)](04-mcp-tool-registry.md) | refactor | L | — |
| 05 | [Duplicate detection: Strategy per detector](05-duplication-detector-strategy.md) | refactor | M–L | 03 |
| 06 | [Unify per-language complexity walkers](06-complexity-walkers.md) | refactor | M–L | — |
| 07 | [Finish adapter migration](07-adapter-migration.md) | refactor | M | — |
| 08 | [CLI command registry (split `runner.ts`)](08-cli-command-registry.md) | refactor | M | 04 (optional) |
| 09 | [Split `compare.ts`, share graph-view helpers](09-compare-and-graph-views.md) | refactor | S–M | — |
| 10 | [Dead code and public API size](10-dead-code-and-public-api.md) | cleanup | S–M | — |
| 11 | [Lower parser / graph complexity hotspots](11-complexity-hotspots.md) | refactor | M | 06 |
| 12 | [Coverage gaps and doc drift](12-coverage-and-doc-drift.md) | hygiene | S | 01 |

## Baseline numbers (to compare against when each part lands)

- 569 nodes, 0 import cycles, 245 public exports, 5 files under 80% coverage, 0 risk hotspots.
- Largest files: `mcp/handlers.ts` 1691 lines, `graph/builder.ts` 850, `mcp/tools.ts` 716,
  `parser/lang/typescript.ts` 711, `graph/duplication/index.ts` 695.
- Hubs by imports: `cli/runner.ts` 36, `graph/duplication/index.ts` 30, `parser.ts` 21.
- Worst cognitive complexity: `findDuplicates` 73, `matchDupGroup` 63, `handleFindDuplicates` 49,
  `detectAllEntryPoints` 47, `loadJvmDependencies` 40, `parseGo` 40.

Re-run `find_complex_functions`, `detect_features`, `find_duplicates` after each part to record the
delta.
