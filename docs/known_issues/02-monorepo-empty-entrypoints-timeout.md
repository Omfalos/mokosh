# Issue 2 — `analyze` with `entryPoints: []` times out in monorepos

Status: proposed, not started. Found dogfooding v0.5.0 against Gradle/sbt JVM monorepos
(2026-09-03).

## Symptom

`analyze({ root, entryPoints: [] })` against a JVM monorepo never returns — Cursor aborts on
its MCP request timeout (~60s). Empty `entryPoints` is the documented way to trigger
monorepo auto-detection (`src/mcp/handlers.ts:177-180`), so this is the primary monorepo
entry path and it is unusable on non-trivial repos.

## Root cause

`handleAnalyze` (`src/mcp/handlers.ts:183`), when `entryPoints.length === 0`:

1. `detectMonorepo(root)` (`handlers.ts:193`).
2. `cache.getOrBuildWorkspace(root, …)` → `createWorkspaceGraph` (`src/index.ts:248`) →
   full per-package `GraphBuilder.build()`.

For JVM packages, `buildJvmPackage` (`src/graph/workspace/detectors/jvm-shared.ts`) sets
`entryPoints` to **every source file in the module** (`collectJvmSources`), so each package's
build enqueues its entire file set — there is no cheap "index file" seed. That is the correct
behaviour for JVM (no single entry point), but every per-package build then also pays:

| Cost | Location | Multiplier |
|---|---|---|
| Rebuild the JVM package index (whole-repo `package`-line scan) | `src/graph/lang-resolvers/jvm.ts:96-102`, fresh `JvmLangResolver` per package (`src/index.ts:280`) | × N packages |
| `processDocFiles(rootDir)` — whole-monorepo markdown walk | `src/graph/builder.ts:180` | × N packages |
| `processTestFiles(commonAncestor)` walk | `src/graph/builder.ts:176` | × N packages (bounded to module dir, cheaper) |
| Sequential package builds | `src/index.ts:271` | no parallelism |
| `detectMonorepo` re-run inside `createWorkspaceGraph` | `src/index.ts:259` | × 2 per request |

Net: roughly `O(N × whole_repo_scan)` filesystem work before the first byte of response.

## Fix plan

This is the same build path as [issue 1](01-monorepo-workspace-packages-timeout.md); apply
the shared perf fixes there:

- **1A** — one workspace-scoped, partitioned JVM package index (from
  [issue 3](03-jvm-cycle-detection-noise.md)) shared across all package builds.
- **1B** — disk-persist the workspace graph, keyed by a source-file `mtime`/`size` digest.
- **1C** — bounded-concurrency package builds.
- **1D** — hoist the doc scan to workspace scope; add `GraphBuilder({ skipDocScan })` used by
  the workspace path.
- **1E** — memoize `detectMonorepo` on `SessionState`; thread the layout into
  `createWorkspaceGraph`.
- **1G** — cache the in-flight `Promise<WorkspaceGraph>` so concurrent `analyze` +
  `get_workspace_packages` share one build.

Additional, specific to `analyze`:

- **2A. Progressive response.** Return a fast first payload from the layout
  (`monorepoType`, `packageCount`, package list) as soon as detection finishes, and build the
  per-package graphs lazily on the first tool call that needs them (`get_workspace_affected`,
  `query`, …). `analyze`'s current return value (`nodeCount`, `categories`, `cycles`) becomes
  best-effort: filled from cache if present, otherwise omitted with a `"graphs building"`
  note.
- **2B. Respect `packages` on the MCP boundary.** `createWorkspaceGraph` already accepts
  `options.packages`; expose it as an `analyze` arg (`AnalyzeArgs.packages?: string[]`) and
  document it as the escape hatch for very large monorepos.
- **2C. Cap `MAX_SCAN_DEPTH` / honor `ignoreDirs`.** `buildPackageIndex`
  (`src/graph/lang-resolvers/jvm.ts:110`) walks to depth 12 and only skips
  `DEFAULT_IGNORE_DIRS`; wire in `MokoshConfig.ignoreDirs` so users can prune generated
  source trees (`build/generated`, `.gradle`, protobuf output) that inflate the scan.

## Expected outcome

- `analyze([])` returns the layout in <1s (2A); mid-size JVM monorepo full-graph build
  completes under the MCP timeout (1A + 1C + 1D); repeat sessions near-instant (1B).
- Large monorepos scoped via `analyze({ packages: [...] })` (2B).

## Test plan

- Unit: `handleAnalyze` with `entryPoints: []` returns a layout payload without awaiting the
  per-package builds (2A) — assert response shape and that `getOrBuildWorkspace` is not
  awaited on the hot path.
- Unit: `analyze({ packages: ["core"] })` builds only the `core` package graph.
- Unit: shared package index built once for an N-package fixture (spy).
- Unit: `MOKOSH_IGNORE_DIRS` / `ignoreDirs` config prunes `buildPackageIndex` (2C).
- Integration: 3-module Gradle fixture — assert `analyze([])` wall time and that a second
  `analyze([])` in the same session hits the cached workspace graph.
- Regression: single-package (non-monorepo) `analyze` behaviour unchanged.

## Files touched

`src/mcp/handlers.ts`, `src/mcp/cache.ts`, `src/mcp/tools.ts`, `src/index.ts`,
`src/graph/builder.ts`, `src/graph/lang-resolvers/jvm.ts`, `src/graph/workspace/index.ts`,
`docs/mcp.md`, `docs/monorepo.md`.

## Dependencies

Shares fixes 1A–1G with [issue 1](01-monorepo-workspace-packages-timeout.md) — implement the
two together. 1A depends on [issue 3](03-jvm-cycle-detection-noise.md)'s partitioned index.
