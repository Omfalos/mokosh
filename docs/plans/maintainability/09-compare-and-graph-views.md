# 09 — Split `compare.ts`, share graph-view helpers

## Problem *(verified)*
- `graph/compare.ts` has about 20 exports and defines 11 interfaces (`FileDiff`, `StaleReference`,
  `DuplicationDelta`, `ComplexityDelta`, `DocDriftDelta`, `CoverageDelta`, `BranchComparison`,
  `BranchComparisonSummary`, ...). It mixes types, diffing, summarising and git orchestration.
- `graph/features/feature-graph.ts` and `graph/type-graph.ts` share about 20 lines of setup/option
  handling (duplicate finder: 15-23 line blocks, 18-25% of each file).
- `graph/responsibility/types.ts` and `types/parse.ts` overlap 47-64% (20-line block).
- `languages/types.ts` and `graph/language-support.ts` share a 22-line block.

## Approach
1. `graph/compare/{types,diff-files,diff-complexity,diff-duplication,diff-docs,diff-coverage,summarize,index}.ts`;
   keep `compare.ts` as a re-export during the move.
2. Extract the shared bounded-view helper (limit, truncated, hint) used by feature graph, type graph
   and API surface into `graph/bounded-view.ts`.
3. Look at the `responsibility/types.ts` ↔ `types/parse.ts` overlap: probably a duplicated enum or
   union; make one the source of truth.
4. Same for `languages/types.ts` ↔ `language-support.ts` (`LANGUAGE_FIDELITY` is documented as derived
   from adapters — verify it really is).

## Done when
No file in `graph/compare/` over ~200 lines, and the duplicate finder no longer reports these four
pairs.
