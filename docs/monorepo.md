# Monorepo Support

Mokosh can analyse monorepos by building one dependency graph per workspace package and stitching them together into a `WorkspaceGraph`. Cross-package import edges are preserved and queryable.

## Supported workspace tools

Detection is attempted in priority order:

1. **Turborepo** — `turbo.json`
2. **Nx** — `nx.json`
3. **pnpm** — `pnpm-workspace.yaml`
4. **Yarn** — `package.json` `workspaces` field
5. **npm** — `package.json` `workspaces` field
6. **Gradle** — `settings.gradle` / `settings.gradle.kts` with `include(...)` modules
7. **sbt** — `build.sbt` + `project/` with `project.in(file("..."))` sub-projects

Multiple tools can be active simultaneously (e.g. Turborepo + pnpm). `detectMonorepo` returns all detected types in `MonorepoLayout.types`.

The JVM detectors (Gradle, sbt) run at lowest priority and only fire for genuinely
multi-module builds — a single-module Gradle/sbt project returns `null` so the repo builds as
one flat graph. Each module's graph is seeded from every JVM source file it contains (JVM
modules have no single index file), and cross-module import edges are tagged `isWorkspace`
after all packages are built by `WorkspaceGraph.annotateCrossPackageEdges()` — the
`JvmLangResolver` resolves cross-module FQN imports via a project-wide package index but is
not itself package-boundary aware. Non-standard `projectDir` / `unmanagedSourceDirectories`
overrides are not honoured (see `docs/adr-017-jvm-languages.md`).

## CLI

Pass no entry points — the CLI detects the workspace automatically. `--workspace-packages` and
`--workspace-affected` build and query a full `WorkspaceGraph` directly:

```bash
mokosh --root /path/to/monorepo --workspace-packages
mokosh --root /path/to/monorepo --workspace-affected --file packages/shared/src/utils.ts
```

Every other command, given no entry points on a detected monorepo root, runs against the **whole
workspace flattened into one `Graph`** — `WorkspaceGraph.flatten()` merges every package's own
nodes into a single namespace with cross-package edges intact — so blast radius, call graphs and
`--query` span package boundaries and every result reports its owning `package`:

```bash
mokosh --root /path/to/monorepo --query "category:logic,sort:complexity,limit:10"
mokosh --root /path/to/monorepo --affected --file packages/shared/src/utils.ts
mokosh --root /path/to/monorepo --query "package:@myorg/api,type:typescript"
```

Pass `--package <name>` to narrow any command to one package, or `--entry` explicitly to opt into
whole-repo-from-these-entry-points behavior, ignoring package boundaries entirely.

## MCP

Pass `entryPoints: []` to `analyze` to trigger workspace detection:

```json
{ "name": "analyze", "arguments": { "root": "/path/to/monorepo", "entryPoints": [] } }
```

This returns the **package layout immediately** (`monorepoType`, `packageCount`, package list).
The per-package dependency graphs are built lazily on the first workspace-aware tool call that
needs edges — so `analyze([])` stays fast even on a large JVM monorepo. Pass `eager: true` to build every
package graph up front and get the `{ nodeCount, categories, cycles }` payload instead.

Once built, the workspace graph is persisted under `mokosh-cache/workspace/` as a small
`manifest.json` ("the map file") plus one `<package>.json` per package. Each package file is
parsed on its own, so a later session hydrating an unchanged repo never has to `JSON.parse` the
whole workspace in one shot (a 190 MB+ single blob used to OOM the MCP server). The manifest
carries a per-package source digest plus a root digest for files under no package; on hydrate
every digest must still match — any stale, oversized (>48 MB serialized), or missing package
discards the whole cache and triggers a full rebuild.

**Very large monorepos:** scope the build to a subset with
`analyze({ entryPoints: [], packages: ["core", "api"] })`. Prune generated source trees from the
JVM package-index scan with `ignoreDirs` in `mokosh.config.json` (or the `MOKOSH_IGNORE_DIRS`
env var). Tune parallelism with `MOKOSH_WORKSPACE_CONCURRENCY` (default: CPU count; `1` = sequential).

`get_workspace_packages` is workspace-specific — every other MCP tool works on a monorepo root
too. `query`, `get_affected`, `get_dependents`, `get_callers`, `get_dependencies`,
`get_type_graph`, `get_call_graph` and `get_feature_graph` run against the flattened
whole-workspace graph (cross-package edges intact, global `sort`/`limit`, each node tagged with
its `package`); the remaining analysis tools fan out per package and concatenate. Pass an
optional `package` argument (or `package:<name>` in a `query` filter) to narrow to one. See
[MCP reference](./mcp.md) for the full breakdown.

Then use the workspace-specific tools:

### `get_workspace_packages`

```json
{ "name": "get_workspace_packages", "arguments": { "root": "/path/to/monorepo" } }
```

Answered from the repo layout and `package.json` manifests alone — **no `analyze` required** and
no graph build. Returns each package with the workspace packages it depends on, plus per-package
`nodeCount` and (for Gradle/sbt) exact `dependsOn` **only when a workspace graph is already
built** — the `dependsOnResolved` / `nodeCountsResolved` flags say which:

```json
{
  "monorepoType": "pnpm",
  "packageCount": 2,
  "dependsOnResolved": true,
  "nodeCountsResolved": true,
  "packages": [
    { "name": "@myorg/shared", "relativeRoot": "packages/shared", "nodeCount": 24, "dependsOn": [] },
    { "name": "@myorg/api",    "relativeRoot": "packages/api",    "nodeCount": 61, "dependsOn": ["@myorg/shared"] }
  ]
}
```

### `get_workspace_affected`

Cross-package blast-radius analysis. Returns every file in the monorepo that could be affected if a given file changes, with each result tagged by its package name.

```json
{
  "name": "get_workspace_affected",
  "arguments": {
    "root": "/path/to/monorepo",
    "file": "packages/shared/src/utils.ts"
  }
}
```

```json
{
  "affected": [
    { "file": "packages/shared/src/index.ts",   "package": "@myorg/shared" },
    { "file": "packages/api/src/handlers/auth.ts", "package": "@myorg/api" }
  ],
  "count": 2
}
```

## Programmatic API

```typescript
import { createWorkspaceGraph } from 'mokosh';

const ws = await createWorkspaceGraph(process.cwd());

// All packages
for (const [name, { graph, pkg }] of ws.packages) {
  console.log(name, '—', graph.nodes.size, 'nodes, root:', pkg.relativeRoot);
}

// Package-level dependency map
const pkgDeps = ws.getPackageDependencies();
// Map<packageName, string[]> — which workspace packages it imports

// Cross-package blast radius for a changed file
const affected = ws.getAffectedAcrossPackages('packages/shared/src/utils.ts');
// Array<{ file: string, package: string }>

// Which package owns a file
const owner = ws.getPackageForFile('packages/api/src/handlers/auth.ts');
// WorkspacePackage | undefined

// Serialise to JSON for caching
const serialized = ws.serialize();
// Later:
const restored = WorkspaceGraph.deserialize(serialized);
```

### Filtering to specific packages

```typescript
const ws = await createWorkspaceGraph(process.cwd(), {
  packages: ['@myorg/api', '@myorg/shared'], // by name
  // or by relative root:
  packages: ['packages/api', 'packages/shared'],
  silent: true,
  gitStats: true,
});
```

## How cross-package edges work

When the resolver encounters an import specifier that matches a workspace package name (e.g. `import { foo } from '@myorg/shared'`), it:

1. Resolves the package's entry point from its `package.json#main` / `exports` field.
2. Creates an `ImportEdge` with `isWorkspace: true` and `workspacePackage: '@myorg/shared'`.
3. Records the edge in the importing package's graph. The dependency is **not** traversed further into the shared package's graph — each package graph remains independent.

`WorkspaceGraph.getAffectedAcrossPackages` bridges this by:
1. Walking incoming import edges within the owning package's graph.
2. Then scanning all other packages for nodes that hold a `isWorkspace` edge pointing at the owner.

## Data types

```typescript
interface WorkspacePackage {
  name: string;         // package.json name, e.g. "@myorg/shared"
  root: string;         // absolute path to the package directory
  relativeRoot: string; // path relative to the monorepo root
  entryPoints: string[]; // resolved entry point absolute paths
}

interface MonorepoLayout {
  root: string;
  type: string;          // primary detected tool, e.g. "turborepo"
  types: string[];       // all detected tools
  packages: WorkspacePackage[];
  packageMap: Map<string, WorkspacePackage>;
}
```

## Adding a custom detector

Detectors are registered via `registerMonorepoDetector`. Each implements `MonorepoDetector`:

```typescript
import { registerMonorepoDetector } from 'mokosh';

registerMonorepoDetector({
  type: 'my-tool',
  detect(rootDir: string): WorkspacePackage[] | null {
    // Return null if this tool is not present in rootDir
    // Return [] if detected but no packages found
    // Return array of WorkspacePackage otherwise
    const configPath = path.join(rootDir, 'my-tool.json');
    if (!fs.existsSync(configPath)) return null;
    // ... parse and return packages
  }
});
```

Register before calling `createWorkspaceGraph` or `detectMonorepo`.