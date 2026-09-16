# Issue 11 — workspace disk cache silently serves stale results after a mokosh code change

## Symptom

After fixing a real bug in mokosh's own parsing/analysis logic (rebuilding `dist` and restarting
the MCP server), `query`/`analyze` on an already-analyzed monorepo kept returning the **pre-fix**
results. `clear_cache` reported success and a fresh `analyze` ran, but the output didn't change.

Found 2026-09-16 while dogfooding the Kotlin annotation-argument grammar fix (see
`src/parser/lang/kotlin/PROGRESS.md`'s "Annotation-argument and use-site-target support" section)
against a local `square/okhttp` checkout: after rebuilding mokosh and restarting the MCP server,
`DnsQuery.kt`/`NativeImageTestsAccessors.kt` still showed no `complexity`/`cognitiveComplexity`
field via `query`, even though a from-scratch parse (a throwaway script reading the freshly
generated parser directly) confirmed both files now parse clean. The only thing that fixed it was
manually `rm -rf`-ing the target repo's `mokosh-cache/` directory.

## Root cause

`clear_cache` (`src/mcp/handlers.ts:1289` → `SessionState.invalidate`, `src/mcp/cache.ts:670-682`)
only drops **in-memory** state (`graphs`, `workspaceGraphs`, `workspaceDigests`, `layouts`,
change-impact caches, `configs`). It never touches the **on-disk** per-package workspace cache
(`<target-repo>/mokosh-cache/workspace/*.json` + `manifest.json`,
`src/graph/workspace/disk-cache.ts`).

That disk cache's own staleness check (`loadWorkspaceCache`, `disk-cache.ts:163-197`) is keyed
entirely off `computeWorkspacePackageDigests` — a digest over the **target repo's own source
files** (`rootDigest` + one `digest` per package) — plus a static `WORKSPACE_CACHE_VERSION`
(`src/const.ts:44`, currently `1`, never bumped by a release). Neither input reflects *mokosh's
own* code/build. So: target repo source unchanged → digest unchanged → disk cache reads as fresh
→ `loadWorkspaceCache` happily hydrates a `WorkspaceGraph` built by the **old** mokosh, regardless
of `clear_cache`, a `dist` rebuild, or an MCP server restart in between.

This is a real correctness gap, not just a perf staleness: any bug fix, grammar change, or
behavior change in mokosh's own analysis logic is invisible to a workspace-scale user until they
manually delete `mokosh-cache/` in every target repo they've previously analyzed.

## Fix (next commit)

Tie the disk cache's freshness check to mokosh's own version/build, not just the target repo's
source. Options, roughly in order of robustness vs. effort:

1. **Bump `WORKSPACE_CACHE_VERSION`** (`src/const.ts:44`) as part of the release process whenever
   analysis-affecting code changes (grammar, resolver, enrichment, complexity/call-edge logic).
   Cheap, but relies on remembering to bump it — the exact kind of manual step that caused this.
2. **Derive the manifest version from mokosh's own `package.json` version** (or a content hash of
   the analysis-relevant source, e.g. everything under `src/parser/`, `src/graph/`) instead of a
   hand-maintained integer constant — self-updating, no release-time step to forget.
3. **Make `clear_cache` also delete the on-disk workspace cache** for `root` (i.e. call into
   `disk-cache.ts` to remove `<root>/mokosh-cache/workspace/`), so the *documented* escape hatch
   actually works even if the automatic version-based invalidation above is deferred. This is the
   minimum fix and should ship regardless of which of 1/2 is chosen, since it also fixes the
   general "I don't trust the cache, force a real rebuild" case `clear_cache` exists for today.

(3) is the safe, narrow fix; (2) is the correct long-term one. Do (3) first, layer (2) on top when
there's time — no reason to block the narrow fix on the bigger one.

## Test plan

- Unit: `loadWorkspaceCache` should return `null` (forcing rebuild) when mokosh's own version/build
  identifier no longer matches what's stored in the manifest, independent of the target repo's
  source digest.
- Unit: `handleClearCache` should remove the on-disk workspace cache directory for `root`, not just
  in-memory state — assert the manifest file is gone after calling it.
- Integration/manual: analyze a repo, change something in mokosh's own analysis path (or bump the
  version knob directly in a test), rebuild, re-analyze without deleting `mokosh-cache/` by hand,
  and confirm the new behavior is reflected.

## Related

- Discovered immediately after and unrelated in cause to the Kotlin annotation-argument grammar
  fix documented in `src/parser/lang/kotlin/PROGRESS.md` — that fix is correct and independently
  verified (both via a direct parser script and, once this cache was cleared by hand, via the live
  MCP server); this issue is purely about the disk cache not knowing the fix had happened.
- See `src/mcp/cache.ts:659-669`'s own doc comment on `invalidate`, which already describes the
  in-memory-only scope accurately — the gap is that scope, not a misunderstanding of it.
