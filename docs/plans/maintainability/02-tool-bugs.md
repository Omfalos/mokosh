# 02 — Tool correctness bugs

Four independent bugs found while dogfooding. Fix and test each separately.

## 2a. `get_callers("findDuplicates")` returns 0 callers *(verified)*
`findDuplicates` is imported and called from `mcp/handlers.ts` and `graph/compare.ts`, yet
`get_callers` returns `{"callers":[],"count":0}`. Memory note: use the call graph, not grep, for
call-site tracing — so this must be trustworthy.
- Investigate: is the callee found through a re-export (`graph/duplication/index.ts`), or skipped
  because the call is inside an `await`/argument position, or because the edge is keyed by a
  different symbol name?
- Add a regression test using a fixture that mirrors the shape.

## 2b. `find_unused` has no response bound *(verified)*
Returns about 54 KB / 727 paths in one line and exceeds the client token limit. Other tools are
already summary-first.
- Default: `count` + `byTopDir` + capped sample (e.g. 30) + `hint`; add `view:"full"` and a
  `filter`/`path` argument.

## 2c. `get_feature_graph` ownership looks skewed *(verified, cause unknown)*
Most hubs report `fileCount: 0` while `handlers` owns 139 files and 349 are unassigned. The rule is
"lowest out-degree hub that can reach the file wins"; `handlers` (out-degree 5) probably wins
everything it reaches.
- Confirm by reading `src/graph/features/feature-graph.ts`; decide whether the tiebreak should be
  shortest path, or exclude shared leaf modules (`types/`, `const.ts`).

## 2d. `get_api_surface` kind `unknown` *(verified)*
44 of 245 public exports have kind `unknown` (e.g. `CALL_EDGE_TYPES`, `CATEGORY_MARKER_TAGS`).
Resolve `const`/`let` initialisers to `const` (plus Set/Map/array subtype if cheap).

## Done when
Each bug has a failing test first, then a fix; `find_unused` on this repo is under ~2 KB by default.
