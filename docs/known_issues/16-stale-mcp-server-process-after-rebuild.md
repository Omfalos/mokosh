# Issue 16 — A running `mokosh` MCP server keeps serving pre-rebuild logic after `npm run build`

Status: **open, not started**. Found dogfooding v0.5.5 via a 4-agent cross-language audit (TS/JS,
Go, JVM/Kotlin, Python) run from a single Claude Code session, 2026-10-03.

## Symptom

Three of the four audits in the same session independently hit the same class of wrong result
from their *bound* `mcp__mokosh__*` tool calls, on three different roots:

- **Python (flask)**: `analyze({root, entryPoints: []})` returned `{"nodeCount":6,"categories":
  {"other":6}}` — only the 6 markdown files, zero Python files — both before and after an explicit
  `clear_cache` call.
- **TS/JS (box-ui-elements)**: `analyze({root, entryPoints: []})` returned a stuck `nodeCount: 3474`
  graph, identically, twice in a row, including once right after `clear_cache` — missing the
  package's own entry point (`src/index.js`) and hundreds of real files. Downstream, `find_unused`
  then flagged `src/index.js` itself as "unused."
- **JVM/Kotlin (ktorio/ktor)**: `get_workspace_packages` reported "not a recognized monorepo root"
  and `analyze({entryPoints: []})` returned the non-monorepo fallback shape (`nodeCount: 77`, all
  `category: "other"`) — i.e. `detectMonorepo()` returned `type: "none"` for a ~136-module Gradle
  build, both before and after `clear_cache`.

In every one of the three cases, the auditing agent isolated the cause by spawning a **fresh**
`node dist/mcp.js` (or `dist/cli.js`) process against the identical root and request sequence,
outside the bound session's MCP connection — and the fresh process returned the correct result
every time (flask: 91 nodes/83 Python files; box-ui-elements: 4407 nodes via a direct
`createImportMap` call seeded with the same stale disk cache the live tool was apparently using;
ktor: 136 Gradle modules correctly detected). The Go audit (gin-gonic/gin) in the same session did
*not* cross-check this way, but its own `entryPoints: []` result (`nodeCount: 33`, missing
`gin.go`/`context.go`/`routergroup.go`) is the **exact symptom and exact node count** documented as
the pre-fix bug in
[issue 14](14-empty-entrypoints-doc-reference-leak.md) ("gin: `CHANGELOG.md` mentions `mode.go`
alone pulled in 33 nodes... 33 → 108 nodes" after the fix) — strong circumstantial evidence the Go
audit hit the same stale-process issue as the other three, just without independent confirmation.

Separately confirmed by directly inspecting running processes during this same session:

```
$ ps aux | grep mcp.js
... 1:18.95 node dist/mcp.js      (started 26Sep26)
... 0:48.91 node dist/mcp.js      (started Sun 01PM)
... 0:00.36 node dist/mcp.js      (started 11:48AM, same day)
$ git log -1 --format=%cd -- dist
Oct  1 21:52:34 2026
```

Multiple long-lived `mokosh` MCP server processes were running simultaneously, at least one
predating the most recent `dist/` rebuild by days. Whichever process a given Claude Code session's
MCP client happens to be connected to is not guaranteed to reflect the code currently on disk.

## Root cause

Not yet isolated to a specific line — the fix for each symptom (issue 14's empty-entrypoints
discovery, issue 15's Gradle unary-plus detection) is confirmed present and working in `dist/` via
a fresh process, so the bug is not in `src/graph/builder.ts` or
`src/graph/workspace/detectors/gradle.ts` themselves. The leading hypothesis, not yet verified by
reading `src/mcp/server.ts`'s process lifecycle:

- `npm run build` (or the Release workflow) overwrites `dist/*.js` on disk, but does nothing to
  signal any already-running `node dist/mcp.js` process to reload or exit — Node has already
  loaded the old module bytecode into memory, so the running process keeps executing pre-rebuild
  logic indefinitely, with no crash, no stale-version error, and (per the three symptoms above) no
  visible sign to the caller that anything is wrong. `clear_cache` only clears `SessionState`'s
  in-memory graph cache and the on-disk `mokosh-cache/workspace/` directory (see
  [issue 11](11-disk-cache-not-invalidated-by-mokosh-version.md)) — neither touches the running
  process's loaded code, so it cannot fix this class of staleness and the audits confirmed it
  doesn't.
- A secondary, not-yet-ruled-out possibility specific to the box-ui-elements case: its root path
  contains a literal colon (`.../js:ts/box-ui-elements`), an unusual character that's a plausible
  trigger for a `root` path-normalization mismatch between whatever key `clear_cache` invalidates
  and whatever key a later `analyze`/`getOrBuild` call looks up — worth tracing explicitly as a
  distinct, narrower possibility alongside the stale-process theory.

## Why this matters beyond "restart your dev server"

This isn't a one-off local inconvenience: `mcp.js` is the long-running server a Claude Code session
stays connected to for the session's entire lifetime per `.mcp.json`. A machine with mokosh used
across multiple repos/sessions over several days (the `ps` output above shows processes 2+ days
apart) can silently accumulate stale server instances, each confidently returning wrong answers
with no caveat, no error, and no way for a caller (human or AI assistant) to know the response
doesn't reflect the currently-installed `mokosh` version — worse than a crash, which at least is
visible.

## Proposed fix (not started)

1. **Minimal**: document that the MCP server must be restarted after any `npm install`/upgrade of
   `@omfalos/mokosh`, or after a local `npm run build` during mokosh development — in
   `docs/mcp.md` and this repo's own `CLAUDE.md`.
2. **Better**: have `mcp.js` stamp its own build identity (e.g. a hash of `dist/` or the installed
   package version) at startup, and have `analyze`/every tool response include it (or a
   `clear_cache`-adjacent `server_info` tool report it) so a caller can at least detect "this
   server predates the code I'm expecting" instead of silently trusting a wrong answer.
3. **Best, bigger**: a self-check at request time — compare the running process's loaded-module
   mtime/hash against `dist/`'s current one and either refuse with a clear "server needs restart"
   error, or (riskier) exit so the MCP client's supervisor restarts it, rather than serving stale
   logic indefinitely.

## Test plan (for whoever picks this up)

- Reproduce deliberately: build `dist/`, start `mcp.js`, modify and rebuild a detector (e.g. tweak
  `gradleDetector`), confirm the already-running process still serves the old behavior.
- Once a build-identity stamp exists: a test that two processes started from different `dist/`
  builds report different identities, and that a tool call surfaces a mismatch signal.

## Cross-issue dependencies

- Confirms issues [14](14-empty-entrypoints-doc-reference-leak.md) and
  [15](15-gradle-unary-plus-dsl-detection.md) are genuinely fixed in current `dist/` — the audits
  that surfaced this issue were themselves initially misread as "14/15 regressed" until each was
  isolated to a stale running process instead.
- Distinct from [issue 11](11-disk-cache-not-invalidated-by-mokosh-version.md): 11 is about a stale
  *on-disk* cache directory; this issue is about a stale *in-memory, already-loaded-code* server
  process that `clear_cache` cannot reach by design (it only ever touches cache state, never the
  process's own loaded code).
