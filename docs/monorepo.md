# Monorepo Support

Mokosh can analyse monorepos by building one dependency graph per workspace package and stitching them together into a `WorkspaceGraph`. Cross-package import edges are preserved and queryable.

## Supported workspace tools

Detection is attempted in priority order:

1. **Turborepo** — `turbo.json`
2. **Nx** — `nx.json`
3. **pnpm** — `pnpm-workspace.yaml`
4. **Yarn** — `package.json` `workspaces` field
5. **npm** — `package.json` `workspaces` field

Multiple tools can be active simultaneously (e.g. Turborepo + pnpm). `detectMonorepo` returns all detected types in `MonorepoLayout.types`.

## CLI

Pass no entry points — the CLI detects the workspace automatically:

```bash
# Analyse full monorepo
mokosh

# Limit to specific packages
mokosh --packages @myorg/api,@myorg/shared
```

## MCP

Pass `entryPoints: []` to `analyze` to trigger workspace detection:

```json
{ "name": "analyze", "arguments": { "root": "/path/to/monorepo", "entryPoints": [] } }
```

Then use the workspace-specific tools:

### `get_workspace_packages`

```json
{ "name": "get_workspace_packages", "arguments": { "root": "/path/to/monorepo" } }
```

Returns each package with its node count and the workspace packages it depends on:

```json
{
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