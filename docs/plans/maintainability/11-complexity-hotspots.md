# 11 — Lower parser / graph complexity hotspots

Cognitive complexity from `find_complex_functions` *(verified)*; parts 04-06 already cover the top
three, so this part is the remainder.

| Function | File | Cog. |
|---|---|---|
| `detectAllEntryPoints` | `graph/api-surface.ts:255` | 47 |
| `loadJvmDependencies` | `parser/lockfile/jvm.ts:34` | 40 |
| `parseGo` | `parser/lang/go.ts:54` | 40 |
| `GraphAnalyzer.componentIds` | `graph/analyzer.ts:184` | 38 |
| `resolveJvmSamePackageCallEdges` | `graph/builder.ts:607` | 33 |
| `parseKotlin` | `parser/lang/kotlin.ts:86` | 33 |
| `collectAccessibleSymbolNames` | `graph/api-surface.ts:186` | 32 |
| `collectRawCallEdges` | `parser/lang/java.ts:152` | 32 |
| `parseJacocoReport` | `graph/coverage/runners/jvm-gradle.ts:25` | 31 |
| `classifyJvm` | `parser/lang/jvm-scan.ts:287` | 30 |
| `filterGraph` | `query/filter.ts:24` | 30 |

## Pattern per case
- Parsers (`parseGo`, `parseKotlin`, `collectRawCallEdges`, `classifyJvm`): **visitor map** keyed by
  node kind, one small function per kind.
- `filterGraph`: same table-of-predicates approach as `matchDupGroup` (part 05); share the helper.
- `detectAllEntryPoints`: one detector per source (`exports`, `bin`, `main`, language hooks),
  composed.
- `componentIds`: rewrite as an explicit iterative (Tarjan/Kosaraju) with named helpers.
- `loadJvmDependencies`, `parseJacocoReport`: split discovery / parse / merge.

## Process
Use the `/complexity-refactor` skill one function at a time, with `/pre-update` first. Do each
function in its own commit; re-run `find_complex_functions` after.

## Done when
No function above cognitive complexity ~25 outside generated code.
