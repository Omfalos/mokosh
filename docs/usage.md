# Usage Guide

Mokosh can be used as a CLI tool or integrated into your Node.js application.

## CLI Options

The CLI is the easiest way to generate JSON or Mermaid outputs.

```bash
npx mokosh [options] <entry-point1> <entry-point2> ...
```

### Options

| Flag | Description |
| --- | --- |
| `--cache [file]` | Path to a cache file. Defaults to `mokosh-cache/graph.json`. If it exists, Mokosh reads the graph from it. Otherwise, it generates the graph and saves it to the file. |
| `--config <file>` | Path to a `mokosh.config.js` / `mokosh.config.json` file. Overrides auto-discovery. |
| `--root <dir>` | Project root directory for path resolution. |
| `--mermaid` | Output a Mermaid diagram string instead of the standard JSON format. |
| `--propose-tags` | Identify changed files using Git and propose affected test tags. |
| `--plain` | Output tags as plain text (one per line) instead of JSON. Use with `--propose-tags`. |
| `--affected-tests` | Like `--propose-tags` but outputs affected test file paths instead of tags. |
| `--detect-features` | Output files with high in-degree (feature hubs), sorted by number of importers descending. |
| `--feature-threshold <N>` | Minimum number of importers for a file to be considered a feature hub (default: `5`). Applies to `--detect-features`, `--propose-tags`, and `--affected-tests`. |
| `--find-unused` | Scan the project for files not reachable from the provided entry points. |
| `--exclude-tests` | Exclude test files from `--find-unused` output. |
| `--find-uncovered` | List non-test files whose line coverage is below the threshold. Requires `coverageReportPath` in config. |
| `--callers --file <path>` | Print files whose exported functions call into the given file (call-graph dependents). |
| `--check-cycles` | Check for circular dependencies; exits non-zero if any are found (CI gate). |
| `--type-graph` | Output type-level graph (interfaces, classes, enums, type aliases). |
| `--type <name>` | Filter `--type-graph` to a single type name. |
| `--module-responsibility` | Output each file's semantic role, description, and exports. |
| `--paths <a,b,...>` | Comma-separated file paths to filter `--module-responsibility` output. |
| `--min-out-degree <N>` | Min internal imports for hub detection (`--module-responsibility`, `--feature-graph`). |
| `--feature-graph` | Group files into feature domains under their hub orchestrators. |
| `--call-graph --function <name>` | Look up callers and callees for a named function. |
| `--api-surface` | Output the public API surface (expands `export *` chains). |
| `--apply-tags` | Write `@tag` annotations into test files from graph tags. |
| `--dry-run` | Preview `--apply-tags` changes without writing to disk. |
| `--query <query>` | Filter the output graph using a query string (e.g., `category:logic,tag:auth`). See the [Query Language Guide](./query.md). |
| `--query-help` | Show all supported query filter keys and examples. |
| `--silent` | Suppress progress output on stderr. |
| `--help` | Show the help menu. |

### Supported Languages

Mokosh supports a wide range of languages out of the box:

- **Logic**: JavaScript (.js, .mjs, .cjs), TypeScript (.ts, .tsx), Python (.py), Go (.go), CoffeeScript (.coffee), LiveScript (.ls), Lua (.lua), Gherkin (.feature).
- **Styles**: CSS (.css), SCSS (.scss), Less (.less), Stylus (.styl).

Each language is parsed using its respective AST library to ensure accurate dependency extraction. Python uses [`@lezer/python`](../docs/adr-002-python-parsing.md) — a pure-JavaScript LR parser with no native compilation required. Go uses [`@lezer/go`](../docs/adr-007-go-resolution.md), with module-local imports resolved via `go.mod`.

**Python-specific notes:**
- All import forms are supported: `import X`, `from X import Y`, relative imports (`from . import X`, `from ..utils import Y`), star imports, aliased imports, and parenthesised multi-line imports.
- Test files are classified by Python conventions: filenames matching `test_*.py` or `*_test.py`, imports of `pytest`/`unittest`/`nose`/`hypothesis`, or a `# @tag test` comment.
- `conftest.py` and `setup.py` are classified as `config`.
- Top-level `def` and `class` definitions are recorded as exports.
- Use `# @tag <name>` in comments to attach custom tags.
- Bare module imports (`import mymodule`) are probed against the project root before being marked external — so local `.py` files and packages (with `__init__.py`) are correctly linked as internal edges.

### Configuration File

Place a `mokosh.config.json` or `mokosh.config.js` in your project root to configure mokosh declaratively. The CLI loads it automatically before building the graph.

**`mokosh.config.json`:**
```json
{
  "cachePath": "custom-cache/graph.json",
  "entryPoints": ["src/index.ts"],
  "ignoreDirs": ["vendor", "generated"],
  "extensions": [".graphql"],
  "configMatchers": [".myconfig."],
  "testPatterns": [".unit.", ".integration."],
  "testLibraries": ["@my-org/test-utils"],
  "barrelThreshold": 0.7
}
```

`ignoreDirs` and `extensions` are **additive** — they extend the built-in defaults rather than replacing them.

**`mokosh.config.js`** (supports side effects and factory functions):
```js
const { registerParser } = require('mokosh');

// Side-effect: register a custom parser before the graph is built
registerParser('unknown', (filePath, content) => ({
  imports: [],
  exports: [],
  tags: [],
  category: 'logic',
}));

// Export config as a plain object or a factory function
module.exports = (defaults) => ({
  ...defaults,
  barrelThreshold: 0.9,
  entryPoints: ['src/main.ts'],
});
```

**Programmatic config loading:**
```typescript
import { loadMokoshConfig, applyConfig, createImportMap } from 'mokosh';

const config = loadMokoshConfig(process.cwd());
applyConfig(config); // registers matchers, patterns, threshold
const graph = await createImportMap(process.cwd(), config.entryPoints ?? ['src/index.ts']);
```

| Config field | Type | Description |
| --- | --- | --- |
| `cachePath` | `string` | Override default `mokosh-cache/graph.json` |
| `entryPoints` | `string[]` | Default entry points when none passed on CLI |
| `ignoreDirs` | `string[]` | Extra dirs to skip (merged with built-in defaults) |
| `extensions` | `string[]` | Extra file extensions to scan (merged with built-in defaults) |
| `configMatchers` | `string[]` | Extra basename substrings that classify a file as `"config"` |
| `testPatterns` | `string[]` | Extra basename substrings that classify a file as `"test"` |
| `testLibraries` | `string[]` | Extra import names that classify a file as `"test"` |
| `barrelThreshold` | `number` | Export-ratio threshold for `"barrel"` detection (default `0.8`) |
| `gitStats` | `boolean` | When `true`, enriches each cache-missed node with `commitCount90d` and `lastAuthor` via `git log`. Off by default. |
| `coverageReportPath` | `string` | Path (relative to project root) to an Istanbul `coverage-summary.json`. When set, each node gets a `coveragePct` field. |
| `coverageThreshold` | `number` | Line-coverage % below which `--find-uncovered` / `find_uncovered` flags a file. Default: `80`. |
| `tagApplier` | `{ framework?, frameworkOverrides? }` | Configures `--apply-tags` output format. `framework` is the fallback test framework (`vitest` \| `playwright` \| `cypress` \| `jest`) used when a file's own imports don't reveal one; `frameworkOverrides` maps path-glob patterns to a framework, checked before the top-level fallback. See [ADR-008](./adr-008-tag-applier-strategies.md). |

### Extensibility

Mokosh features a pluggable parser architecture. You can register custom parsers for new file types or override existing ones:

```typescript
import { registerParser } from 'mokosh';

registerParser('lua', (filePath, content) => {
  // Custom logic to extract imports, exports, tags, and category
  return {
    imports: [],
    exports: [],
    tags: ['custom'],
    category: 'logic'
  };
});
```

### Advanced Metadata Extraction

Mokosh goes beyond simple dependency tracking by extracting:

- **Tags**: Structured objects `{ name: string, kind: "function" | "class" | "variable" | "type" | "import" | "comment-marker" }`. Extracted via five strategies — top-level declaration names, `@word` in string literals, `@tag <name>` in comments, Vitest `{ tags: [...] }` / Playwright `{ tag: '...' }` option bags, and graph-derived tags (test files gain tags from the basenames of their local imports). See the [Test Tag guide](./test-tags.md) for details.
- **Categories**: Automatically classifies files as `logic`, `ui`, `test`, `config`, `barrel`, or `type-only` based on heuristics (imports, exports, naming).
- **Exports**: Named exports are now structured objects: `{ name, doc?, flags?, signature? }`. `doc` is the JSDoc description, `flags` captures lifecycle markers (`deprecated`, `internal`, `public`, `alpha`, `beta`), and `signature` is the human-readable type signature.
- **File description**: The JSDoc comment on the first statement of a JS/TS file is stored as `description` on the node. Query with `hasDocstring:true/false`.
- **Call Edges**: Beyond import edges, Mokosh records cross-file function/method calls as `callEdges: { from, to, toFile }[]` on each non-test node.
- **Tested-By Index**: After the graph is built, logic and barrel nodes are enriched with `testedBy: string[]` — the relative paths of test files that directly import them.
- **Git Stats**: When `gitStats: true` is set in config, each newly built (cache-missed) node is enriched with `commitCount90d` (number of commits in the last 90 days) and `lastAuthor` (email of the most recent committer).

### Lock File Support

Mokosh automatically detects `package-lock.json`, `yarn.lock`, and `pnpm-lock.yaml` in the project root. When a lock file is present, Mokosh:

1. **Enriches External Dependencies**: Automatically retrieves the installed version of each `node_modules` dependency.
2. **Auto-Tagging**: Automatically adds tags to your files based on the libraries they import (e.g., if a file imports `react`, it gets a `react` tag). This makes it easy to filter or search your graph by library usage.

### Examples

**Analysing style dependencies (CSS / SCSS / Less / Stylus):**

Mokosh understands style-specific import forms — `@import`, `@use`, `@forward` (SCSS), and `@require` (Stylus) — and automatically classifies stylesheet files as `barrel` (import-only aggregators) or `ui` (files with actual rule blocks).

```bash
# Graph all stylesheets reachable from a SCSS entry point
npx mokosh src/styles/index.scss

# Show only stylesheet barrel files (pure import aggregators)
npx mokosh --query "category:barrel" src/styles/index.scss
```

Example output for a SCSS barrel index (`_index.scss` that only forwards tokens):
```json
{
  "path": "src/styles/_index.scss",
  "type": "scss",
  "category": "barrel",
  "imports": [
    { "rawSpecifier": "./tokens/colors", "type": "re-export", "isStyle": true },
    { "rawSpecifier": "./tokens/typography", "type": "re-export", "isStyle": true }
  ]
}
```

**Filter graph by category and tag:**
```bash
npx mokosh --query "category:logic,tag:auth" src/index.ts
```

For more details on filtering, see the [Query Language Guide](./query.md).

**Exporting a JSON graph of your project:**
```bash
npx mokosh src/main.ts > graph.json
```

**Generating a Mermaid diagram for documentation:**
```bash
npx mokosh --mermaid src/main.ts > dependency-graph.mmd
```

**Proposing tags for CI/CD pipelines:**
```bash
npx mokosh --propose-tags src/tests/e2e.test.ts
```

**Finding unused files:**
```bash
npx mokosh --find-unused src/main.ts
```

**Detecting feature hub files:**
```bash
npx mokosh --detect-features src/main.ts
```

Output:
```json
{
  "features": [
    { "path": "src/utils.ts", "inDegree": 14, "tag": "feature:utils" },
    { "path": "src/config.ts", "inDegree": 8, "tag": "feature:config" }
  ]
}
```

**Proposing tags with a custom feature threshold:**
```bash
npx mokosh --propose-tags --feature-threshold 3 src/main.ts
```

## Programmatic API

For custom integrations, use the exported functions and classes.

### Creating a Graph

```typescript
import { createImportMap } from 'mokosh';

const graph = await createImportMap(process.cwd(), ['src/index.ts']);
```

### Monorepo / Workspace Graph

Use `createWorkspaceGraph` for monorepos. It auto-detects the workspace layout (Turborepo, Nx, pnpm, Yarn, npm) and builds one graph per package.

```typescript
import { createWorkspaceGraph } from 'mokosh';

const ws = await createWorkspaceGraph(process.cwd());

// List packages
for (const [name, { graph, pkg }] of ws.packages) {
  console.log(name, pkg.relativeRoot, graph.nodes.size, 'nodes');
}

// Cross-package blast radius
const affected = ws.getAffectedAcrossPackages('packages/shared/src/utils.ts');
for (const { file, package: pkg } of affected) {
  console.log(`${pkg}: ${file}`);
}

// Limit to specific packages
const partial = await createWorkspaceGraph(process.cwd(), {
  packages: ['@myorg/api', '@myorg/shared'],
});
```

See [Monorepo Support](./monorepo.md) for details.

### Coverage-annotated Graph

```typescript
import { createImportMap, loadCoverageMap } from 'mokosh';

const rootDir = process.cwd();
const coverageMap = loadCoverageMap(rootDir, 'coverage/coverage-summary.json');
const graph = await createImportMap(rootDir, ['src/index.ts'], null, { coverageMap });

// Each node now has coveragePct
for (const node of graph.nodes.values()) {
  if ((node.coveragePct ?? 100) < 80) {
    console.log(`Low coverage: ${node.path} (${node.coveragePct}%)`);
  }
}
```

### Serializing and Deserializing

Caching is crucial for large projects to avoid re-parsing the entire AST on every run.

```typescript
import { createImportMap, Graph } from 'mokosh';
import fs from 'fs';

// Save to cache
const graph = createImportMap(process.cwd(), ['src/index.ts']);
const serialized = graph.serialize();
fs.writeFileSync('cache.json', JSON.stringify(serialized));

// Load from cache
const raw = JSON.parse(fs.readFileSync('cache.json', 'utf-8'));
const cachedGraph = Graph.deserialize(raw);
```

### Proposing Tags Programmatically

```typescript
import { createImportMap, proposeTags, getGitDiffFiles } from 'mokosh';

const graph = await createImportMap(process.cwd(), ['src/index.ts']);
const changedFiles = getGitDiffFiles(); // Uses git diff --name-only
const tags = proposeTags(graph, changedFiles);

console.log('Affected Tags:', tags);
```

Pass `featureDetection` options to short-circuit traversal at hub files and get feature-level tags:

```typescript
const tags = proposeTags(graph, changedFiles, {
  featureDetection: { minInDegree: 3 },
});
// If a changed file is a hub: tags will include e.g. "feature:utils"
// If traversal passes through a hub: stops there, adds the hub's tag
```

Set `featureDetection: false` to disable hub short-circuiting and always traverse to test nodes:

```typescript
const tags = proposeTags(graph, changedFiles, { featureDetection: false });
```

### Detecting Feature Hubs Programmatically

```typescript
import { createImportMap, detectFeatures } from 'mokosh';

const graph = await createImportMap(process.cwd(), ['src/index.ts']);
const featureMap = detectFeatures(graph.nodes, { minInDegree: 5 });

for (const feature of featureMap.values()) {
  console.log(`${feature.path} — ${feature.inDegree} importers → tag: ${feature.tag}`);
}
```

### Finding Unused Files Programmatically

```typescript
import { createImportMap, getAllProjectFiles } from 'mokosh';

const rootDir = process.cwd();
const graph = createImportMap(rootDir, ['src/index.ts']);
const allFiles = getAllProjectFiles(rootDir);
const unusedFiles = graph.findUnusedFiles(allFiles);

console.log('Unused Files:', unusedFiles);
```
