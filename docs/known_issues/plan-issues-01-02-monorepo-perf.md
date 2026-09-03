# Plan — Issues 1 + 2: monorepo `analyze` / `get_workspace_packages` timeout

Consolidated implementation plan for
[issue 1](01-monorepo-workspace-packages-timeout.md) and
[issue 2](02-monorepo-empty-entrypoints-timeout.md). They are the same build path
(`createWorkspaceGraph`) hit from two MCP entry tools, so they are fixed together.

## Status — all phases implemented

| Phase | Fix | State |
|---|---|---|
| P1 | 1F — cheap `get_workspace_packages` listing | ✅ `summarizeWorkspaceLayout`, handler no longer builds |
| P2 | 2A — progressive `analyze([])` + `eager` / `packages` args | ✅ layout returned immediately, lazy build via `ensureFreshWorkspace` |
| P3 | 1A — shared JVM package index | ✅ one `JvmLangResolver` via `defaultLangResolvers({ jvm })` |
| P4 | 1D — workspace-scoped doc scan | ✅ `GraphBuilder(docFiles)`, `assignDocsToPackages` (one walk) |
| P5 | 1E + 1G — memoize `detectMonorepo`, share in-flight build | ✅ `SessionState.getLayout`, `workspaceBuilds` promise map |
| P6 | 1C — bounded-concurrency package builds | ✅ `resolveWorkspaceConcurrency`, `MOKOSH_WORKSPACE_CONCURRENCY` |
| P7 | 1B — disk-persist workspace graph | ✅ `workspace-graph.json` + `computeWorkspaceSourceDigest` |
| P8 | 2B + 2C — `packages` arg, `ignoreDirs` into `buildPackageIndex` | ✅ `JvmLangResolver(extraIgnoreDirs)`, `MOKOSH_IGNORE_DIRS` honored |
| P9 | per-package incremental workspace rebuild | ✅ `createWorkspaceGraph({ previousWorkspace })` |

Tests: `src/graph/workspace/{layout-summary,shared-jvm-index,workspace-doc-scan,workspace-incremental}.test.ts`,
plus additions to `src/mcp/{handlers,cache}.test.ts`. Full suite green, typecheck + lint clean.

Behaviour change: `analyze([])` on a monorepo now returns a layout-only payload by default
(was `{ nodeCount, categories, cycles }`); top-level docs outside every package are no longer
folded into every package graph.

## Goal / success criteria

1. `get_workspace_packages` returns in **< 1 s** on any monorepo, with **no graph build**
   (issue 1 headline — fix **1F**).
2. `analyze({ entryPoints: [] })` returns the **layout payload in < 1 s**; the per-package
   graph build happens lazily on the first tool call that needs edges (issue 2 headline —
   fix **2A**).
3. When a full workspace graph *is* built, a mid-size JVM monorepo (~3–8 modules, a few
   thousand source files) completes **under the MCP ~60 s ceiling** (1A + 1C + 1D + 1E).
4. Second and later MCP sessions against an unchanged repo **load from disk** instead of
   rebuilding (1B).
5. Single-package (non-monorepo) `analyze` behaviour is **byte-for-byte unchanged**.

## What was already in place before this work

Issue 1/2's fix **1A** was written assuming issue 3's partitioned JVM index still needed
building. It already landed (commits `f327151`, `61c1bbf`):

- `src/graph/lang-resolvers/jvm.ts` already keys the index as
  `Map<packageName, PackagePartition[]>` where each partition is
  `{ module, rootSegment, sourceRoot, files }`.
- `JvmLangResolver.indexCache` is already keyed by `rootDir`, and every package's
  `GraphBuilder` in `createWorkspaceGraph` is constructed with `rootDir = abs` (the
  monorepo root).

⇒ **1A collapsed to sharing a single `JvmLangResolver` instance** across the per-package
`DefaultResolver`s (via the `ResolverOptions.langResolvers` seam). No index redesign.

## Root-cause recap (the compounding costs, N = package count)

| # | Cost | Location |
|---|------|----------|
| a | Fresh `JvmLangResolver` per package ⇒ whole-repo 4 KB head-read of every JVM file **× N** | `src/index.ts`, `jvm.ts` |
| b | `processDocFiles()` walks the **whole monorepo** once **per package** | `src/graph/builder.ts` |
| c | Packages built strictly sequentially (`for…of`) | `src/index.ts` |
| d | `detectMonorepo` runs 2×/request (`handleAnalyze` + `createWorkspaceGraph`) | `handlers.ts`, `index.ts` |
| e | No disk persistence for workspace graphs | `src/mcp/cache.ts` |
| f | `get_workspace_packages` forces a full build for data derivable from manifests | `handlers.ts`, `queries.ts` |
| g | MCP call is fully blocking, no interim response | `src/mcp/server.ts` |

## Design — phased

Phases are independently shippable. **P1 + P2 alone resolve both headline symptoms**;
P3–P9 bring the full-build path under budget and make repeat sessions instant.

### P1 — Cheap listing path for `get_workspace_packages` (1F)

`handleGetWorkspacePackages` stops calling `ensureFreshWorkspace`.

- New `summarizeWorkspaceLayout(layout, builtGraph?)` in
  `src/graph/workspace/layout-summary.ts`:
  - `monorepoType`, `packageCount`, per-package `name` / `relativeRoot` from `detectMonorepo`.
  - `dependsOn`: best-effort — JS monorepos from each package's `package.json` deps intersected
    with sibling names; build-system monorepos without manifests get `[]` and
    `dependsOnResolved: false`.
  - `nodeCount`: optional — populated only from an already-cached workspace graph, else omitted
    with a `note`.
- Handler answers with `detectMonorepo` + manifest scan only; no `GraphBuilder`.

### P2 — Progressive `analyze([])` (2A)

- Non-eager (default): return `summarizeWorkspaceLayout(layout, cached?)` immediately, store
  `lastAnalyze` + start watching, **do not** `await getOrBuildWorkspace`.
- Per-package build triggered lazily by the first `ensureFreshWorkspace` call that needs edges
  (`get_workspace_affected`, …); `ensureFreshWorkspace` builds on demand when nothing is cached.
- `analyze({ entryPoints: [], eager: true })` keeps the old build-and-return behaviour.
- New `AnalyzeArgs.eager?: boolean` and `AnalyzeArgs.packages?: string[]`, plus schema.

### P3 — Shared JVM package index across package builds (1A)

`createWorkspaceGraph` constructs one `sharedJvmResolver = new JvmLangResolver(...)` and passes
`langResolvers: defaultLangResolvers({ jvm: sharedJvmResolver })` into each package's
`DefaultResolver`. `defaultLangResolvers` is a new factory in
`src/graph/lang-resolvers/index.ts` so `DefaultResolver`'s default list and this call site stay
in sync. The index is built once (memoised by `rootDir`) and reused by every package.

### P4 — Hoist the doc scan to workspace scope (1D)

- `GraphBuilder` gets a `docFiles: string[] | null` constructor arg: `null` → walk `rootDir`
  (default), an array → enqueue exactly those absolute paths (skip the walk).
- `createWorkspaceGraph` walks the monorepo `.md`/`.mdx` tree once (`assignDocsToPackages`),
  assigns each doc to the package whose root directory most specifically contains it (docs
  outside every package are dropped), and passes each package its slice.
- `createImportMap` threads a `docFiles` option through (default `null`).

### P5 — Memoise `detectMonorepo` + share the in-flight build (1E, 1G)

- `SessionState.getLayout(root)` memoises `detectMonorepo` per root (cleared in `invalidate`);
  `createWorkspaceGraph` accepts a `layout` option so detection is not repeated.
- `SessionState.workspaceBuilds: Map<string, Promise<WorkspaceGraph>>` — `getOrBuildWorkspace`
  returns an in-flight promise if one exists, stores it before awaiting, deletes it on settle.

### P6 — Bounded-concurrency package builds (1C)

- `resolveWorkspaceConcurrency(packageCount)` → `MOKOSH_WORKSPACE_CONCURRENCY` if a positive
  integer, else CPU count, clamped to `[1, packageCount]`.
- A tiny promise-pool replaces the `for…of`; results collected by original index so package
  registration order stays deterministic.
- When concurrency > 1, per-package parsing runs in-process (avoids piscina oversubscription).

### P7 — Disk-persist the workspace graph (1B)

- `DEFAULT_WORKSPACE_GRAPH_CACHE_FILE = "workspace-graph.json"` in `src/const.ts`.
- `computeWorkspaceSourceDigest(root)` → `{ digest, files }`, a sha-256 over every source
  file's `path\0mtimeMs\0size` (one `getAllProjectFiles` walk, reused by
  `createWorkspaceGraph` via a `projectFiles` option so it isn't repeated).
- `getOrBuildWorkspace`: on a cold start, hydrate `{ digest, graph }` from disk when the digest
  matches; otherwise build and write. Never throws — a bad/foreign/stale file degrades to a
  rebuild. `forceFresh` (set by `ensureFreshWorkspace` after a watcher event) skips hydration.

### P8 — Escape hatches for very large monorepos (2B, 2C)

- **2B**: `packages` arg threaded from `analyze` → `getOrBuildWorkspace` → `createWorkspaceGraph`
  (which already honours `options.packages`).
- **2C**: `JvmLangResolver` takes `extraIgnoreDirs`; `buildPackageIndex` merges
  `DEFAULT_IGNORE_DIRS ∪ MOKOSH_IGNORE_DIRS ∪ extraIgnoreDirs`. `createWorkspaceGraph` passes
  `MokoshConfig.ignoreDirs` through to the shared resolver and to each per-package `GraphBuilder`.

### P9 — Per-package incremental workspace rebuild

- `createWorkspaceGraph` accepts `previousWorkspace?: WorkspaceGraph`; each package's
  `GraphBuilder` gets `previousWorkspace.packages.get(pkg.name)?.graph ?? null` as its
  incremental base, so a one-package edit re-parses only the changed files.
- `ensureFreshWorkspace` passes the prior graph as `previousWorkspace` on a dirty rebuild.

## Aggregate test plan

- New integration fixtures under `src/graph/workspace/`:
  - `layout-summary.test.ts` — manifest-derived `dependsOn`, `dependsOnResolved` flag,
    built-graph path.
  - `shared-jvm-index.test.ts` — 3-module Gradle fixture: each `.java` package line read once
    (not once per package), cross-module FQN edges, `additionalIgnoreDirs` prunes a generated
    tree, sequential vs. concurrent builds identical.
  - `workspace-doc-scan.test.ts` — a package's doc lands in that package's graph, not a
    sibling's; a top-level doc is dropped.
  - `workspace-incremental.test.ts` — incremental rebuild after a one-package edit matches a
    cold rebuild.
- `src/mcp/handlers.test.ts` — `get_workspace_packages` no-build path; progressive `analyze`;
  `eager: true`.
- `src/mcp/cache.test.ts` — layout memoization, in-flight build sharing, disk round-trip,
  digest-mismatch rebuild, `forceFresh`.
- Regression: single-package `analyze` unchanged; `get_workspace_affected` output identical.

## Files touched

`src/mcp/handlers.ts`, `src/mcp/cache.ts`, `src/mcp/tools.ts`, `src/index.ts`, `src/const.ts`,
`src/graph/builder.ts`, `src/graph/resolver.ts`, `src/graph/lang-resolvers/index.ts`,
`src/graph/lang-resolvers/jvm.ts`, `src/graph/workspace-model.ts`,
`src/graph/workspace/index.ts`, `src/graph/workspace/layout-summary.ts` (new),
`docs/mcp.md`, `docs/monorepo.md`, plus test files.

## Risks / watch-items

- **P2 changes the `analyze([])` contract** — layout-only payload by default. Mitigated by
  `eager: true` and a `note`; called out in `docs/mcp.md` and the changelog (`fix!`).
- **P4 doc-assignment**: nearest-`relativeRoot` rule matches `WorkspaceGraph.getPackageForFile`;
  a doc above all package roots is dropped rather than duplicated into every package.
- **P6 parallel builds + piscina**: first cut uses in-process parsing when packages run in
  parallel; revisit only if profiling shows parsing (not FS) is the remaining cost.
- **P7 digest cost**: computed as a by-product of the single `getAllProjectFiles` walk that
  `createWorkspaceGraph` already needs for doc assignment.
