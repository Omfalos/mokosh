# Query Language Guide

Mokosh includes a powerful, lightweight query engine that allows you to filter the dependency graph. This is especially useful for reducing the amount of data sent to AI models (Token Saving) or for focusing on specific parts of a large project.

## Why it's needed

1.  **Token Saving**: Large dependency graphs can easily exceed the context limits of AI models. By filtering the graph to only include relevant files (e.g., only logic files or files with a specific tag), you can provide more context with fewer tokens.
2.  **Noise Reduction**: In complex projects, you might only care about a specific subsystem. Filtering by path or category helps you focus on what's important.
3.  **CI/CD Optimization**: You can use queries to identify specific subsets of tests or components that need to be analyzed.

## Query Syntax

The query is a comma-separated string of `key:value` pairs.

```bash
--query "key1:value1,key2:value2"
```

### Supported Keys

| Key | Description | Example |
| --- | --- | --- |
| `path` | Matches if the file path *contains* the value. | `path:src/api` |
| `type` | Matches the exact file type (e.g., `typescript`, `python`). | `type:python` |
| `package` | Exact match on the owning workspace package name. Prefix with `"!"` to exclude. Only meaningful on a monorepo root (where the query runs across the whole flattened workspace and every result node reports its `package`); a no-op elsewhere. | `package:@org/app`, `package:!@org/legacy` |
| `category` | Matches the exact node category (e.g., `logic`, `ui`, `test`). | `category:logic` |
| `tag` / `tags` | Matches if the file has **any** of the specified tags (OR). Prefix with `"!"` to exclude. | `tag:auth`, `tag:!test` |
| `tag` (AND syntax) | Use `+` within the value to require **all** listed tags (AND). | `tag:auth+core` |
| `external` | Matches if the node is considered external (value: `true` or `false`). | `external:true` |
| `importsFile` | Matches if the node directly imports the given path (substring). | `importsFile:src/utils` |
| `importedBy` | Matches if the node is directly imported by the given path (substring). | `importedBy:src/index` |
| `minImports` | Matches nodes with at least N direct imports. | `minImports:5` |
| `maxImports` | Matches nodes with at most N direct imports. | `maxImports:2` |
| `minSize` | Matches nodes whose file size is at least N bytes. | `minSize:1024` |
| `maxSize` | Matches nodes whose file size is at most N bytes. | `maxSize:4096` |
| `hasDocstring` | Matches nodes that have (`true`) or lack (`false`) a JSDoc description on the first statement. | `hasDocstring:true` |
| `minCoverage` / `maxCoverage` | Line coverage % is at least/at most N. No-data nodes are excluded from `minCoverage`, treated as 0% for `maxCoverage`. | `minCoverage:80` |
| `minExportUsage` / `maxExportUsage` | Average `exportUsageRatio` (0–1) is at least/at most N. Same no-data convention as coverage. | `maxExportUsage:0.2` |
| `minComplexity` / `maxComplexity` | McCabe cyclomatic complexity is at least/at most N (see [Architecture: Complexity metrics](./architecture.md)). No-data nodes (languages other than TS/JS/Go/Python) excluded from `min`, treated as 0 for `max`. | `minComplexity:15` |
| `minCognitiveComplexity` / `maxCognitiveComplexity` | Cognitive complexity is at least/at most N (see [Architecture: Complexity metrics](./architecture.md)). Same no-data convention as complexity. | `minCognitiveComplexity:10` |
| `minCommits` / `maxCommits` | `commitCount90d` is at least/at most N (requires `gitStats: true`). Same no-data convention. | `minCommits:5` |
| `isDocumented` | Matches nodes that have (`true`) or lack (`false`) at least one markdown doc referencing them. | `isDocumented:false` |
| `isStale` | Matches nodes flagged as doc-stale (`true`) by `check-doc-drift`, i.e. `staleFor` is non-empty. | `isStale:true` |
| `lastAuthor` | Exact match on the file's most recent git author (requires `gitStats: true`). Negate with `!`. | `lastAuthor:jane` |
| `any(key:val\|key:val)` | OR-group: node matches if it satisfies **any** single-key clause inside the group. ANDed with every other key in the query string. Each clause is one `key:value` pair — multi-key AND clauses inside a group aren't supported. | `any(category:logic\|category:ui)` |
| `sort` | Sort results by `size`, `imports`, `commitCount90d`, `exportUsage`, `complexity`, or `cognitiveComplexity`. | `sort:imports` |
| `sortDir` | Sort direction for `sort`: `asc` or `desc`. Defaults to `desc`. | `sort:size,sortDir:asc` |
| `limit` | Return at most N nodes after filtering and sorting. | `limit:20` |

> **Note**: If multiple filter keys are provided, a node must match **all** criteria (AND logic), except inside an `any(...)` group, which is OR logic among its own clauses. `sort` and `limit` apply after filtering. The literal substring `any(` is reserved syntax — a query value that happens to contain it verbatim will be misparsed, similar to how `+` is reserved inside `tag:` values.

## Examples

### Filter by Language
Only show TypeScript files in the graph:
```bash
npx mokoash --query "type:typescript" src/index.ts
```

### Filter by Category
Only show files categorized as `logic` (excludes styles, configs, etc.):
```bash
npx mokosh --query "category:logic" src/index.ts
```

### Filter by Tag (OR)
Find all files tagged with `@tag core`:
```bash
npx mokosh --query "tag:core" src/index.ts
```

### Filter by Multiple Tags (AND)
Find files that have **both** the `auth` and `core` tags — use `+` to AND tags within a single key:
```bash
npx mokosh --query "tag:auth+core" src/index.ts
```

### Filter by Documentation
Find all TypeScript logic files that are missing a JSDoc description:
```bash
npx mokosh --query "type:typescript,category:logic,hasDocstring:false" src/index.ts
```

### Complex Queries
Find the 10 largest logic files in the `services` directory tagged with `api`:
```bash
npx mokosh --query "path:services,category:logic,tag:api,sort:size,limit:10" src/index.ts
```

### OR Logic Across Keys
Use `any(key:val|key:val)` to match a node against several unrelated criteria — the node
passes the group if it satisfies **any one** of the clauses inside it. It's still ANDed with
every other key in the query string:
```bash
# Files in either the "logic" or "ui" category
npx mokosh --query "any(category:logic|category:ui)" src/index.ts

# Files under src/ that are tagged auth OR payments
npx mokosh --query "path:src,any(tag:auth|tag:payments)" src/index.ts
```
Each `|`-separated clause must be a single `key:value` pair — `any(a:1,b:2|c:3)` (multi-key
clauses joined by `,` inside the group) is not supported.

### Sort Direction and Complexity
Find the 10 least-churned files with the lowest cognitive complexity:
```bash
npx mokosh --query "sort:cognitiveComplexity,sortDir:asc,limit:10" src/index.ts
```

## `find_duplicates` filter DSL

`find_duplicates` (MCP `filter` arg, CLI `--dup-query`) takes a **separate** `key:value` string
that filters *duplicate-group results*, not graph nodes. Same comma-separated, AND-across-keys
shape; string values take a leading `!` for negation. Parsed by `parseDupQuery`, applied by
`matchDupGroup`. An unknown key or malformed clause **throws** (unlike the node query DSL, which
silently ignores unknown keys) so a typo fails loudly instead of returning nothing.

The MCP tool is **summary-first**: with no `filter` and no `view` it returns just `summary` +
a small `clusters` preview + a `hint`. A `filter` returns `summary` + the matching `clusters`;
add `view: "groups"` for the raw per-span `groups`, or `view: "full"` for both. (The CLI
`--find-duplicates` command still prints the full `summary` + `groups` + `clusters`.)

| Key | Meaning |
|---|---|
| `path:<substr>` / `path:!<substr>` | at least one / no occurrence's path contains this |
| `allPaths:<substr>` | *every* occurrence's path contains this (an entirely-within-one-module dup) |
| `family:<js\|jvm\|style\|python\|go\|lua\|markdown\|gherkin\|other>` | language family (`!` negates) |
| `type:<lang>` | every occurrence resolves to this `FileType` (e.g. `typescript`); `!` = none does |
| `kind:<block\|definition>` | span match vs declaration-level match |
| `defKind:<cssVar\|interface\|type\|objectLiteral\|jsxElement>` | which declaration a `definition` group matched |
| `minLines:<N>` / `maxLines:<N>` | block size in lines |
| `minScore:<N>` / `maxScore:<N>` | logic-token score (falls back to `lines` for `definition` groups) |
| `minOccurrences:<N>` | repeated at least N times |
| `crossFile:<bool>` | `true` = occurrences span ≥2 files, `false` = all in one file |
| `signal:<name>` / `signal:!<name>` | has / lacks a signal (`same-file`, `generated`, `value-drift`, `svg-markup`, `test`, `docs`); repeatable, positives OR-matched |
| `sort:<lines\|score\|occurrences>` / `sortDir:<asc\|desc>` | ordering (default `desc`) |
| `limit:<N>` | cap |

```bash
# TypeScript duplicates outside tests, spanning multiple files, ≥20 lines
npx mokosh --find-duplicates --dup-query "type:typescript,path:!test,crossFile:true,minLines:20"

# Only the CSS variable drift, most-repeated first
npx mokosh --find-duplicates --dup-query "defKind:cssVar,signal:value-drift,sort:occurrences"
```

`crossPackage` is intentionally absent: on a monorepo `find_duplicates` scans each package
independently, so a duplicate group never spans packages. The predicate is applied *before*
clustering, so `clusters` narrow together with `groups`. `sort`/`limit` are applied after the
per-package merge.

## Node Categories

Mokosh automatically categorizes files based on their content and naming conventions:

- `logic`: Standard code files (JS, TS, Python, etc.).
- `ui`: Files that appear to be UI components (e.g., importing React, Vue, or having `.jsx`/`.tsx` extensions).
- `test`: Files with `.test.`, `.spec.`, or in `__tests__` directories.
- `config`: Configuration files (e.g., `jest.config.js`, `tsconfig.json`).
- `barrel`: Files that only re-export other files (e.g., `index.ts` with only exports).
- `type-only`: TypeScript files that only contain interfaces or types.

## Using Queries Programmatically

You can also use the query engine in your own code:

```typescript
import { createImportMap, parseQuery, filterGraph } from 'mokosh';

const graph = await createImportMap(process.cwd(), ['src/index.ts']);
const serialized = graph.serialize();

const query = parseQuery("category:logic,tag:auth");
const filtered = filterGraph(serialized, query);

console.log(JSON.stringify(filtered, null, 2));
```
