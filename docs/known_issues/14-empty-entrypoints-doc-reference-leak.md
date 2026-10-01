# Issue 14 — `analyze(entryPoints: [])` on a plain repo silently built a partial graph seeded by markdown doc-reference edges

Status: **shipped**. Found dogfooding v0.5.4 against gin-gonic/gin, ktorio/ktor, and pallets/flask.

## Symptom

Calling `analyze` (or `createImportMap` directly) with `entryPoints: []` on a plain
(non-monorepo) repo produced a small graph that looked like a normal, complete result, but was
actually an arbitrary, non-deterministic subset of the real source tree — determined entirely by
which source files happened to be mentioned by path somewhere in the repo's markdown docs.

Confirmed on three real repos:

- **gin-gonic/gin**: `CHANGELOG.md` mentions `mode.go` by name. That one mention alone produced a
  33-node graph (`mode.go` plus its real transitive imports: `binding/`, `codec/json/`,
  `internal/bytesconv/`) — leaving `gin.go`, `context.go`, `routergroup.go`, `render/`, and ~40
  other real Go source files completely absent, with no indication anything was missing.
- **ktorio/ktor**: no markdown file in the repo mentions a `.kt` file by a path-like token the
  markdown parser's `PATH_TOKEN_PATTERN` recognizes (`.kt`/`.kts`/`.java`/`.scala`/`.groovy`
  aren't in `CODE_EXTENSIONS`, `src/parser/lang/markdown.ts` — a separate, smaller gap). Result:
  **zero** Kotlin/Java files in the graph at all — just markdown and `unknown`-typed files, for a
  ~3,300-source-file repo.
- **pallets/flask**: similarly small/partial, for the same underlying reason.

## Root cause

`GraphBuilder.build(entryPoints)` (`src/graph/builder.ts`), with an empty `entryPoints` array,
enqueued nothing — the queue started genuinely empty. The *only* things that got discovered
afterward were test files (`processTestFiles`) and doc files (`processDocFiles`).

But a markdown file's doc-reference edges (`ImportEdge.isDocReference`, extracted by
`src/parser/lang/markdown.ts` from links and path-like tokens in code spans/fences) are resolved
and **enqueued exactly like a real import** in `resolveImports` — there was no distinction
between "a doc mentions this file, so link it for doc-drift purposes" and "treat this as a real
dependency root to recursively explore from." Once a doc-referenced file like `mode.go` entered
the queue, the normal wavefront took over: its own real imports were parsed and resolved exactly
as if `mode.go` were a deliberately-chosen entry point, pulling in its whole transitive
dependency tree — while every other file not reachable from that one accidental seed was silently
absent, with the result shape (`{nodeCount, categories, cycles, languageCoverage}`) looking
identical to a genuine, complete analysis.

This wasn't a Go-specific bug or an "entry-point detection" feature gap — there was no entry-point
detection happening at all. It was a side effect of combining two independently-reasonable design
choices (doc-reference edges recursively expand like real imports; `processDocFiles` runs
unconditionally) in the one case neither was designed for: zero real entry points.

## Fix

`GraphBuilder.build()`: when `entryPoints` is empty, instead of leaving the queue empty, a new
`processAllSourceFiles()` pass discovers every non-test, non-doc file under `rootDir` matching a
known source extension (`DEFAULT_EXTENSIONS` minus `.md`/`.mdx`, reusing the existing
`walkProject` helper and `getTestPatterns()` exclusion) and enqueues each as its own entry point —
deterministic, complete, and no longer dependent on what a doc happens to mention. `processDocFiles`
and `processTestFiles` still run afterward exactly as before, now scoped correctly since every
real source file is already in the graph.

This only changes behavior for a plain repo's zero-entry-point path. A monorepo package's
`entryPoints` is never actually empty from any built-in detector — `detectMonorepo`'s JVM
detectors (`src/graph/workspace/detectors/jvm-shared.ts`) return `null` (excluding the package
entirely) rather than an empty array when no entry points are found, and every JS/npm-family
detector (`npm`, `yarn`, `pnpm`, `nx` — `src/graph/workspace/shared.ts`'s `resolveEntryPoints` /
`nx.ts`'s `resolveNxEntryPoints`) always pushes fallback candidate paths (`src/index.ts`, etc.)
even when unverified against the filesystem; Turborepo never constructs a `WorkspacePackage`
directly at all (it defers to pnpm/yarn/npm) — confirmed by reading every detector before
shipping this fix, so `processAllSourceFiles` (which would otherwise scan the whole monorepo
root instead of one package's subtree, since `GraphBuilder`'s `rootDir` for a workspace package
build is the monorepo root, not the package's own directory) never actually triggers for a
built-in detector's workspace package build.

A **custom** detector registered via the public `registerMonorepoDetector` API has no such
guarantee, though — `MonorepoDetector`'s contract doesn't forbid an `entryPoints: []` package.
`createWorkspaceGraph` (`src/index.ts`) now guards this explicitly: a package with
`entryPoints.length === 0` builds an empty `Graph` directly instead of calling
`GraphBuilder.build([])`, so even a custom detector can't trigger an accidental whole-monorepo
scan for one package.

Not fixed here, left as a separate smaller gap: `src/parser/lang/markdown.ts`'s
`CODE_EXTENSIONS`/`PATH_TOKEN_PATTERN` doesn't include JVM language extensions (`.kt`, `.kts`,
`.java`, `.scala`, `.groovy`), so a JVM source file mentioned by path in a doc's code span never
produces a doc-reference edge at all — meaning `enrichDocDrift`'s stale-doc detection silently
can't see JVM file mentions. Worth a follow-up if doc-drift accuracy on JVM repos matters.

## Test plan

- `src/graph/builder.test.ts` (new "GraphBuilder empty entryPoints auto-discovery" describe
  block): a repo with one doc-referenced file and one unrelated, unreferenced file — both must
  appear in the graph (the exact regression this fix closes); test files and doc files are still
  correctly discovered and categorized via their own dedicated passes; a file reachable only via
  a real import (not a doc reference) is still found; a workspace package built with an injected
  custom `MonorepoLayout` carrying `entryPoints: []` builds an empty graph rather than scanning
  the whole monorepo root (the `createWorkspaceGraph` guard above).
- Manual, against real checkouts: gin-gonic/gin (33 → 108 nodes, now including `context.go`/
  `routergroup.go`), ktorio/ktor (0 → 3,210 Kotlin files), pallets/flask (22 → 83 Python files
  when called with `entryPoints: []`, vs. the 22 reachable from an explicitly-given
  `src/flask/__init__.py`).

## Cross-issue dependencies

None directly, though it was found during the same dogfooding pass as issues 12 and 13
(call-graph empty results) — all three came from auditing `analyze`/MCP tool output against real
third-party repos rather than mokosh's own (much smaller, better-covered) codebase.
