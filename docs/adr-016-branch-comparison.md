# ADR-016: Branch/PR Comparison (`compare_branches`)

**Date:** 2026-08-28
**Status:** Accepted

---

## Context

Every existing quality tool (`find_duplicates`, `find_complex_functions`, `find_risk_hotspots`,
`check_doc_drift`) answers a question about *one* graph snapshot. Reviewing someone else's PR is
inherently comparative — "did this change introduce duplication?", "did every call site of a
renamed export get updated?", "did complexity or doc drift get worse?" — and answering that meant
running each tool twice by hand against two checkouts and diffing the JSON manually.

This adds `compare_branches` (MCP tool and `--compare-branches` CLI flag): it builds the graph for
a second git ref and reports the deltas mokosh can already compute per-graph, plus one new
cross-graph check.

---

## Decision

### Materializing the "other" ref: `git worktree`, not `git show` blobs

Two ways to get a `Graph` for a ref other than the current checkout were considered:

1. **`git worktree add`** a temporary directory at the target commit, then run the normal
   `GraphBuilder`/parser pipeline against real files on disk.
2. **`git show <ref>:<path>`** each file's content into an in-memory FS shim and feed that through
   the parsers without touching disk.

Option 1 was chosen (`src/graph/worktree.ts`). It reuses `GraphBuilder` exactly as-is — no parser,
resolver, or piscina-worker code needed an in-memory-source variant. Option 2 would have required
threading an alternate file-read path through every parser, every lang-resolver (`fs.existsSync`
checks for directory/package resolution), and the tokenizer used by `find_duplicates`, for a
feature that's inherently a one-shot, not-hot-path operation — the complexity wasn't justified.
The cost is a real (if lightweight) `git worktree add`/`remove` per uncached ref, which
`withWorktree` always cleans up via `finally`, using `--detach` so the temporary checkout never
claims a branch name and can't conflict with the caller's own working tree.

### Caching: keyed by commit sha, not branch name

A given commit's graph never changes, so `buildGraphAtRef` (`src/graph/compare.ts`) resolves the
ref to a sha first (`resolveRef`, `git rev-parse --verify <ref>^{commit}`) and checks
`<root>/mokosh-cache/branch-graphs/<sha>.json` (`src/graph/branch-graph-cache.ts`) before paying
for a worktree checkout. Keying by sha rather than by ref/branch name means the cache entry is
immutable and needs no invalidation logic — unlike the main graph cache (`graph-loader.ts`),
which is mtime/size-keyed because the working tree does change. Repeated comparisons against the
same base commit (e.g. re-running `compare_branches` after `main` hasn't moved) are then free
after the first call. `--clear-cache`/`clear_cache` removes the whole `branch-graphs/` directory
alongside the other disk caches.

### The head side is never checked out

`compareBranches(rootDir, baseRef, headGraph, options)` takes the head graph as a parameter
instead of also resolving+checking it out. The head side is virtually always "whatever `analyze`
already built" — the current working tree, kept fresh via the same `ensureFresh`/incremental-mtime
mechanism every other MCP tool uses. Requiring a second worktree checkout for HEAD would double
the cost for no benefit in the common case; `options.headRef` only labels the head side in the
result, it doesn't drive a second checkout.

### What gets diffed

- **File diff** (`diffFiles`) — added/removed paths, plus "changed" for a path present on both
  sides whose category, export names, or import target set differs.
- **Stale references** (`findStaleReferences`) — the one genuinely new check, not just a delta of
  an existing tool: for every file present on both sides, an export name that existed at base but
  is gone at head is flagged if any head-side importer's `ImportEdge.symbols` still names it. This
  is the "did the user update every call site" signal — a rename or removal whose caller was
  never updated.
- **Duplication / complexity / doc drift / coverage** — each delegates to the existing
  `findDuplicates` / `findComplexFunctions` / `staleFor` data / `findRiskHotspots`, run once per
  side, diffed by a stable identity (a sorted `file:line` occurrence signature for duplicate
  groups, `file:functionName` for hotspots) so before/after result ordering never produces a false
  "new" or "resolved" entry. Coverage is `null` when either side has no coverage data loaded,
  mirroring `find_risk_hotspots`'s own guard rather than misreporting every function as a
  regression.

### Output: summary by default

`compareBranches()` always computes the full `BranchComparison`; `summarizeBranchComparison()`
then projects it to a `BranchComparisonSummary` and that is what the MCP tool and CLI emit by
default (`detail: "full"` / `--compare-full` opts back into the raw object). The full result is a
data dump whose largest sections (`complexity.newHotspots`, `duplication.newGroups`) scale with
the size of the diff — exactly when a low-token result matters most. The summary keeps the
decision-support content and drops the bulk:

- delta lists are capped at `maxItems` (default 8) as compact `file:line name (score)` strings,
  with a separate true `*Count`;
- "things that got better" (`resolvedHotspots`, `resolvedGroups`) collapse to a bare count;
- sections with no delta are omitted entirely;
- a `verdict` + `headline[]` lead, so a reviewer (human or AI) can stop reading after two lines
  when nothing is alarming;
- `staleReferences` — the one "possible bug" signal — is passed through in full, never truncated.

A realistic 30-file refactor drops from ~2.5–3.5k tokens to ~300–500; a model that wants
everything asks once with `detail: "full"`.

---

## Consequences

**Positive**

- Reuses every existing analysis function unchanged (`findDuplicates`, `findComplexFunctions`,
  `findRiskHotspots`, `hasCoverageData`) — no duplicated logic between single-graph and
  comparison tools.
- The sha-keyed cache means the (relatively expensive) base-ref build only happens once per
  commit, regardless of how many times a PR is re-reviewed against the same base.

**Negative / trade-offs**

- A `git worktree add`/`remove` pair is real filesystem + git-index work; comparing against a
  ref that's never been compared before is noticeably slower than any single-graph query. This is
  accepted as a one-shot review operation, not a hot path.
- The comparison only ever checks out `baseRef` — if a caller wants to compare two *arbitrary*
  refs where neither is the current working tree, they must first build/cache the head graph
  themselves (e.g. via a separate `buildGraphAtRef` call) rather than getting that for free from
  `compare_branches` alone.
