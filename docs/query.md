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
| `sort` | Sort results by `size`, `imports`, or `commitCount90d`. | `sort:imports` |
| `limit` | Return at most N nodes after filtering and sorting. | `limit:20` |

> **Note**: If multiple filter keys are provided, a node must match **all** criteria (AND logic). `sort` and `limit` apply after filtering.

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
