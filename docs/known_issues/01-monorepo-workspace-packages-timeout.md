# Issue 1 — `get_workspace_packages` times out in MCP clients on monorepos

Status: proposed, not started. Found dogfooding v0.5.0 against Gradle/sbt JVM monorepos
(2026-09-03).

## Symptom

Calling `get_workspace_packages` from Cursor against a medium/large JVM monorepo never
returns — the MCP client aborts on its request timeout (~60s). Same underlying build as
[issue 2](02-monorepo-empty-entrypoints-timeout.md); this issue tracks the `get_workspace_packages`
entry point and the cheap-listing fix specific to it.

## Root cause

`handleGetWorkspacePackages` (`src/mcp/handlers.ts:680`) calls
`cache.ensureFreshWorkspace(root)` → `getOrBuildWorkspace` (`src/mcp/cache.ts:154`) →
`createWorkspaceGraph` (`src/index.ts:248`). That does a **full per-package dependency-graph
build** before it can answer, even though the tool's payload (`monorepoType`, `packageCount`,
per-package `name` / `relativeRoot` / `dependsOn`) is almost entirely derivable from the
monorepo manifests without building any graph.

Only `nodeCount` in the response actually needs the built graph
(`summarizeWorkspacePackages`, `src/mcp/handlers.ts:686`).

Compounding costs in the full build (N = package count):

| Cause | Location | Cost |
|---|---|---|
| JVM package index rebuilt per package — each package's `GraphBuilder` gets a fresh `DefaultResolver` → fresh `JvmLangResolver`, whose `indexCache` is per-instance | `src/index.ts:277-289`, `src/graph/lang-resolvers/jvm.ts:96-102` | N × whole-repo 4 KB head-read of every `.java/.kt/.scala/.groovy` |
| `processDocFiles(rootDir)` runs once **per package**, always over the whole monorepo | `src/graph/builder.ts:180` | N × whole-repo markdown walk |
| Packages built strictly sequentially | `src/index.ts:271` (`for…of`) | no cross-package parallelism |
| `detectMonorepo` runs 2–3× per request (handleAnalyze + createWorkspaceGraph), each Gradle/sbt `detect` walking every module via `collectJvmSources` | `src/mcp/handlers.ts:193`, `src/index.ts:259`, `src/graph/workspace/detectors/jvm-shared.ts` | additive |
| No disk persistence for workspace graphs (single-package graphs have `mokosh-cache/` via `src/cli/graph-loader.ts`) | `src/mcp/cache.ts:154-169` | every fresh session = full rebuild |
| MCP call fully blocking, no interim response | `src/mcp/server.ts:109` | hard ~60s ceiling |

## Fix plan

### 1F (this issue's headline fix) — cheap listing path

Split `get_workspace_packages` so it answers from the layout alone:

- Return `monorepoType`, `packageCount`, and per-package `name` / `relativeRoot` / `dependsOn`
  straight from `detectMonorepo` + manifest parsing (`settings.gradle`, `build.sbt`,
  `package.json` `dependencies`). No `GraphBuilder`.
- Make `nodeCount` **optional** — populate it only from an already-cached workspace graph;
  omit it (or return `null` with a `"graph not built"` note) otherwise.
- Update `summarizeWorkspacePackages` and the tool's JSON Schema / `docs/mcp.md` accordingly.
- Keep `get_workspace_affected` requiring the full graph (it genuinely needs edges).

### Shared perf fixes (also close issue 2)

- **1A. One workspace-scoped JVM package index.** Build the package index once for the
  monorepo root; inject it into every package's `JvmLangResolver`. Design it partitioned as
  `Map<packageName, Array<{ module: string; sourceRoot: string; files: string[] }>>` so it is
  reused directly from [issue 3](03-jvm-cycle-detection-noise.md). Wire it through
  `DefaultResolver` options (like `workspaceMap`) or a shared resolver instance in
  `createWorkspaceGraph`.
- **1B. Persist workspace graphs to disk**, keyed by root + a digest of every source file's
  `mtime`/`size` (mirror `graph-loader.ts`). `getOrBuildWorkspace` hydrates when the digest
  matches; sessions 2..N load instead of rebuild.
- **1C. Build packages with bounded concurrency** in `createWorkspaceGraph` (respect the
  piscina pool budget — cap at `min(N, cpuCount)` and disable per-package parallel parsing
  when running packages in parallel, or share one pool).
- **1D. Hoist the doc-file scan to workspace scope** — scan `rootDir` for `.md/.mdx` once in
  `createWorkspaceGraph`, assign each doc to its nearest package, and skip
  `processDocFiles` in the per-package `GraphBuilder` when it is invoked from the workspace
  path (add a `skipDocScan` / `docFiles` option to `GraphBuilder`).
- **1E. Memoize `detectMonorepo(root)` on `SessionState`** and pass the resolved layout from
  `handleAnalyze` into `createWorkspaceGraph` (new optional `layout` param) so detection runs
  once per request.
- **1G. Share the in-flight build promise** — `getOrBuildWorkspace` should store the pending
  `Promise<WorkspaceGraph>` in the cache, so a second concurrent call (e.g. `analyze` then
  `get_workspace_packages`) awaits the first build instead of starting its own.

## Expected outcome

- `get_workspace_packages` returns in <1s on any monorepo (1F — no graph build).
- First `analyze`/`get_workspace_affected` on a mid-size JVM monorepo drops under the MCP
  timeout (1A + 1C + 1D + 1E); subsequent sessions are near-instant (1B).
- Very large monorepos: callers scope with `analyze({ packages: [...] })` (already supported
  in `createWorkspaceGraph`; document it in `docs/mcp.md`).

## Test plan

- Unit: `handleGetWorkspacePackages` returns package list with **no** `analyze` call and no
  graph in the cache; `nodeCount` present only when a workspace graph is cached.
- Unit: `createWorkspaceGraph` builds the JVM package index exactly once (spy on the index
  builder) for an N-package fixture.
- Unit: `detectMonorepo` called once per `handleAnalyze` (spy).
- Integration: fixture monorepo under `test/fixtures/` with 3 Gradle modules sharing a
  package name — assert `get_workspace_packages` timing and correctness.
- Regression: disk-cache round-trip — build, persist, mutate one file, reload → only the
  changed package rebuilds.

## Files touched

`src/mcp/handlers.ts`, `src/mcp/cache.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts`,
`src/index.ts`, `src/graph/builder.ts`, `src/graph/lang-resolvers/jvm.ts`,
`src/graph/workspace/index.ts`, `docs/mcp.md`, `docs/monorepo.md`.

## Dependencies

Do [issue 3](03-jvm-cycle-detection-noise.md) first — 1A consumes its partitioned package
index. 1F is independent and can land immediately.
