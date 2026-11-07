# 01 — Exclude worktrees / nested repos from discovery

## Problem
`.claude/worktrees/agent-*` is git-ignored *(verified: `git check-ignore`)* but every mokosh tool
still scans it. Each worktree is a full copy of the repo, so results are multiplied.

## Evidence *(verified)*
- `find_duplicates`: top cluster is `kotlin/tokens.js` ×3 (two are worktree copies), score 667.
- `check_doc_drift`: 77 stale docs, about 60 of them under `.claude/worktrees`.
- `compare_branches`: "+31 complexity hotspots", mostly worktree copies of one file; 273 docs
  "newly stale".
- `find_unused`: 727 files, almost all under `.claude/`.
- `get_api_surface.unreachableFromEntry` is dominated by worktree markdown.

## Approach
1. Treat any directory containing a `.git` file or directory (other than the root) as a nested
   repo/worktree and skip it during FS-walk discovery.
2. Add `.claude/worktrees` to `DEFAULT_IGNORE_DIRS` (`src/const.ts:65`) as a belt-and-braces entry.
3. Check that reference-driven discovery (markdown code-span links, imports) also respects the
   rule — `graph/duplication/index.ts` documents that `graph.nodes` is *not* ignore-filtered.
4. Consider honoring the root `.gitignore` for discovery (separate decision; may be costly on
   large repos).

## Files
`src/const.ts`, `src/graph/builder.ts` (discovery passes), `src/graph/resolver.ts` (reference-driven
discovery).

## Risks
Legitimate nested git repos (submodules, vendored repos) would be skipped; make the nested-repo
rule configurable in `mokosh.config`.

## Done when
Re-running the tools on this repo shows no `.claude/worktrees` paths; node count drops; add a test
with a fixture containing a nested `.git`.
