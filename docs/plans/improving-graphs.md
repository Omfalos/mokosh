# Plan: Improving the JS/TS Knowledge Graph

Derived from analysis of what the current graph stores vs. what an AI knowledge graph needs.
Covers JS/TS only. Ordered by sequencing dependency — later features depend on earlier ones.

---

## Dependency order

```
Feature 3  (structured tags)          ← start here, highest blast radius
Feature 1+4+2  (JSDoc + flags + signatures)  ← one PR
Feature 7  (testedBy mapping)          ← independent, tiny
Feature 6  (git velocity)              ← independent, needs config guard
Features 8–12  (query enhancements)    ← one PR, only src/query/ files
Feature 5  (call graph)                ← last, most complex
Feature 13 (hasDocstring query)        ← after Feature 1 lands
```

---

## Feature 3 — Structured tags

**Complexity: M** — highest blast radius; do this first to unblock everything else.

### Why

Tags are currently `string[]`. An AI cannot distinguish `'createImportMap'` (function name) from `'node:fs'` (imported module) from `'TODO'` (comment marker). Structuring them enables semantic queries.

### Type changes — `src/types.ts`

```ts
export type TagKind = 'function' | 'class' | 'variable' | 'type' | 'import' | 'comment-marker';

export interface StructuredTag {
  name: string;
  kind: TagKind;
}

// In GraphNode:
tags: StructuredTag[];   // was string[]
```

### `src/parser/tagging/index.ts`

Change every `ctx.tags.add(name: string)` to `ctx.tags.add({ name, kind })`. Derive `kind` from the existing `ts.isFunctionDeclaration` / `ts.isVariableDeclaration` checks already in each strategy:

- `collectDeclarationNameTags` — use `'function'` when initializer is arrow/function expression, `'class'` for class declarations, `'type'` for interface/type alias, else `'variable'`
- `collectStringLiteralAtTags` — use `'comment-marker'`
- `collectCommentAnnotationTags` — use `'comment-marker'`
- `collectVitestOptionBagTags` — use `'comment-marker'`

### `src/graph/enrichment.ts`

```ts
// before
tags.push(libName);
!tags.includes(libName)

// after
tags.push({ name: libName, kind: 'import' });
!tags.some(t => t.name === libName)
```

### `src/query/filter.ts`

```ts
// before
node.tags.includes(t)

// after
node.tags.some(st => st.name === t)
```

---

## Features 1 + 4 + 2 — JSDoc, flags, and type signatures

**Complexity: M** — implement as a single PR; all three share the same new `ExportedSymbol` type and the same compiler-API pass in `code.ts`.

### Why

The graph knows `createImportMap` is exported but not what it does, what types it accepts, or whether it is deprecated. This is the single biggest gap for AI-assisted tooling.

### Type changes — `src/types.ts`

```ts
export interface ExportedSymbol {
  name: string;
  doc?: string;        // leading JSDoc comment text
  flags?: string[];    // @deprecated | @internal | @public | @alpha | @beta
  signature?: string;  // e.g. "(rootDir: string, entryPoints: string[]) => Promise<Graph>"
}

// In GraphNode:
exports: ExportedSymbol[];   // was string[]

// In FileNode:
description?: string;        // file-level JSDoc block
```

### Type changes — `src/parser/types.ts`

```ts
// ParseContext:
exports: Map<string, ExportedSymbol>;   // was Set<string>

// ParseResult:
exports: ExportedSymbol[];              // was string[]
description?: string;
```

### `src/parser/code.ts` — three new private helpers

```ts
// Feature 1 — JSDoc text
function extractJsDoc(node: ts.Node): string | undefined {
  const cmts = ts.getJSDocCommentsAndTags(node);
  for (const c of cmts) {
    if (ts.isJSDoc(c) && c.comment)
      return ts.getTextOfJSDocComment(c.comment) || undefined;
  }
  return undefined;
}

// Feature 4 — JSDoc flags
function extractJsDocFlags(node: ts.Node): string[] | undefined {
  const KNOWN = new Set(['deprecated', 'internal', 'public', 'alpha', 'beta']);
  const tags = ts.getJSDocTags(node)
    .map(t => t.tagName.text)
    .filter(name => KNOWN.has(name));
  return tags.length > 0 ? tags : undefined;
}

// Feature 2 — type signature (no full TypeChecker needed, printer only)
function extractSignature(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const printer = ts.createPrinter({ removeComments: true });
  const print = (n: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, n, sourceFile);

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    const params = node.parameters.map(print).join(', ');
    const ret = node.type ? print(node.type) : 'void';
    const tps = node.typeParameters
      ? `<${node.typeParameters.map(tp => tp.name.text).join(', ')}>`
      : '';
    return `${tps}(${params}) => ${ret}`;
  }
  if (ts.isVariableDeclaration(node)) {
    if (node.type) return print(node.type);
    if (node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const fn = node.initializer;
      const params = fn.parameters.map(print).join(', ');
      const ret = fn.type ? print(fn.type) : 'unknown';
      return `(${params}) => ${ret}`;
    }
    return undefined;
  }
  if (ts.isClassDeclaration(node) && node.name) return `class ${node.name.text}`;
  if (ts.isInterfaceDeclaration(node))           return `interface ${node.name.text}`;
  if (ts.isTypeAliasDeclaration(node))           return print(node.type);
  if (ts.isEnumDeclaration(node))                return `enum ${node.name.text}`;
  return undefined;
}
```

Change every `ctx.exports.add(name)` call to:

```ts
ctx.exports.set(name, {
  name,
  doc:       extractJsDoc(node),
  flags:     extractJsDocFlags(node),
  signature: extractSignature(node, sourceFile),
});
```

File-level `description` comes from the JSDoc attached to `sourceFile.statements[0]`.

---

## Feature 7 — Persisted test coverage mapping

**Complexity: S** — pure post-build enrichment, zero parser changes.

### Why

`propose_affected_tests` derives test-to-file mappings dynamically but nothing is persisted. An AI can't answer "what tests cover this file?" without re-running analysis.

### Type changes — `src/types.ts`

```ts
// In FileNode:
testedBy?: string[];   // paths of test-category nodes that import this node
```

### `src/graph/enrichment.ts` — new function

```ts
export function enrichTestedBy(nodes: Map<string, FileNode>): void {
  for (const node of nodes.values()) {
    if (node.category !== 'test') continue;
    for (const imp of node.imports) {
      if (imp.isExternal || !imp.toPath) continue;
      const target = nodes.get(imp.toPath);
      if (!target) continue;
      if (target.category !== 'logic' && target.category !== 'barrel') continue;
      target.testedBy ??= [];
      if (!target.testedBy.includes(node.path))
        target.testedBy.push(node.path);
    }
  }
}
```

### `src/graph/builder.ts`

Call `enrichTestedBy(this.graph.nodes)` alongside the existing enrichment calls in `build()`.

---

## Feature 6 — Git velocity

**Complexity: S** — guard behind `config.gitStats: boolean` to avoid slowing non-git repos.

### Why

`mtime` tells you when a file last changed, not how often. Files with high `commitCount90d` are riskier to touch; `lastAuthor` helps route questions.

### Type changes — `src/types.ts`

```ts
// In FileNode:
commitCount90d?: number;
lastAuthor?: string;
```

### `src/git.ts` — new helper

```ts
export interface GitFileStats {
  commitCount90d: number;
  lastAuthor: string | undefined;
}

export function getGitFileStats(rootDir: string, relativePath: string): GitFileStats {
  // git -C <rootDir> log --follow --format="%ae" --since="90 days ago" -- <relativePath>
  // Use execSync with { encoding: 'utf-8', stdio: ['ignore','pipe','ignore'] }
  // lines = output.split('\n').filter(Boolean)
  // return { commitCount90d: lines.length, lastAuthor: lines[0] }
}
```

### `src/graph/builder.ts`

Call `getGitFileStats` in `getNode()` after node construction. Wrap in try/catch so git failures are silent. Skip entirely when `config.gitStats !== true`.

**Performance note:** The existing `mtime`/`size` cache already short-circuits `getNode` for unchanged files — git stats are only fetched for new or modified files.

---

## Features 8–12 — Query enhancements

**Complexity: S×5** — all in one PR; touches only `src/query/` files.

### Type changes — `src/query/types.ts`

```ts
export interface NodeQuery {
  // existing fields unchanged …

  importsFile?: string;          // substring match on imp.toPath
  importedBy?: string;           // substring match on importer paths
  minImports?: number;
  maxImports?: number;
  minSize?: number;
  maxSize?: number;
  allTags?: string[];            // AND logic (all must match); existing tags = OR
  sort?: 'size' | 'imports' | 'commitCount90d';
  limit?: number;
}
```

### `src/query/filter.ts`

Add guards in `matchNode`:

```ts
if (query.importsFile) {
  if (!node.imports.some(imp => imp.toPath?.includes(query.importsFile!))) return false;
}
if (query.allTags?.length) {
  if (!query.allTags.every(t => node.tags.some(st => st.name === t))) return false;
}
if (query.minImports !== undefined && node.imports.length < query.minImports) return false;
if (query.maxImports !== undefined && node.imports.length > query.maxImports) return false;
if (query.minSize    !== undefined && node.size    < query.minSize)    return false;
if (query.maxSize    !== undefined && node.size    > query.maxSize)    return false;
```

For `importedBy`, build a reverse index once in `filterGraph` before the loop (O(E)):

```ts
const reverseIndex = new Map<string, string[]>();
for (const n of graph.nodes)
  for (const imp of n.imports)
    if (imp.toPath) {
      const arr = reverseIndex.get(imp.toPath) ?? [];
      arr.push(n.path);
      reverseIndex.set(imp.toPath, arr);
    }
```

Then in `matchNode` (or a wrapper that receives the index):

```ts
if (query.importedBy) {
  const importers = reverseIndex.get(node.path) ?? [];
  if (!importers.some(p => p.includes(query.importedBy!))) return false;
}
```

At the end of `filterGraph`, after collecting `resultNodes`:

```ts
if (query.sort) {
  resultNodes.sort((a, b) => {
    if (query.sort === 'size')           return b.size - a.size;
    if (query.sort === 'imports')        return b.imports.length - a.imports.length;
    if (query.sort === 'commitCount90d') return (b.commitCount90d ?? 0) - (a.commitCount90d ?? 0);
    return 0;
  });
}
if (query.limit !== undefined) resultNodes.splice(query.limit);
```

### `src/query/parse.ts`

Add one `case` per new keyword (all lowercase):

```ts
case 'importsfile':    query.importsFile  = value;                              break;
case 'importedby':     query.importedBy   = value;                              break;
case 'minimports':     query.minImports   = parseInt(value, 10);                break;
case 'maximports':     query.maxImports   = parseInt(value, 10);                break;
case 'minsize':        query.minSize      = parseInt(value, 10);                break;
case 'maxsize':        query.maxSize      = parseInt(value, 10);                break;
case 'sort':           query.sort         = value as NodeQuery['sort'];         break;
case 'limit':          query.limit        = parseInt(value, 10);                break;
case 'tag':
case 'tags':
  if (value.includes('+')) {
    query.allTags = [...(query.allTags ?? []), ...value.split('+')];
  } else {
    query.tags = [...(query.tags ?? []), value];
  }
  break;
```

---

## Feature 5 — Call graph

**Complexity: L** — implement last; most complex; touches parser and builder.

### Why

The graph tracks that file A imports file B, but not which function in A calls which function in B. A 1-line call in a rarely-executed branch is treated the same as a call in the hot path.

### Type changes — `src/types.ts`

```ts
export interface CallEdge {
  from: string;    // exported function name in this file
  to: string;      // called symbol name
  toFile: string;  // resolved relative path (same form as ImportEdge.toPath)
}

// In FileNode:
callEdges?: CallEdge[];
```

### Type changes — `src/parser/types.ts`

```ts
export interface RawCallEdge {
  from: string;
  to: string;
  toSpecifier: string;   // raw import specifier; resolved to toFile post-build
}

// In ParseResult:
rawCallEdges: RawCallEdge[];
```

### `src/parser/code.ts` — two-step detection

**Step 1** (parse time): after the main `visit(sourceFile)` loop, build a `Map<symbol, rawSpecifier>` from all static `ImportDeclaration` nodes. Then for each top-level exported function body, walk `CallExpression` nodes: when the callee identifier is in the map, record `{ from: functionName, to: callee, toSpecifier }` in `ctx.rawCallEdges`.

Scope limits to avoid noise:
- Only top-level exported functions (no nested functions, no test-file bodies)
- Only callees whose identifier is in the static-import map
- Skip dynamic `import()` calls (already handled separately)
- Skip calls to global identifiers (`String`, `Array`, `console`, etc.)

**Step 2** (build time in `src/graph/builder.ts`): after `resolveImports()`, iterate `rawCallEdges`, resolve each `toSpecifier` to an absolute path using the existing resolver, convert to the relative form, assign to `node.callEdges`.

---

## Feature 13 — `hasDocstring:` filter

**Complexity: S** — depends on Feature 1 (`description` field on `FileNode`).

### `src/query/types.ts`

```ts
hasDocstring?: boolean;
```

### `src/query/filter.ts`

```ts
if (query.hasDocstring !== undefined) {
  if (!!node.description !== query.hasDocstring) return false;
}
```

### `src/query/parse.ts`

```ts
case 'hasdocstring': query.hasDocstring = value.toLowerCase() !== 'false'; break;
```

---

## Complexity summary

| Feature | Size | PR | Depends on |
|---------|------|----|------------|
| 3 — Structured tags | M | 1 | — |
| 1+4+2 — JSDoc + flags + signatures | M | 2 | — |
| 7 — testedBy mapping | S | 3 | — |
| 6 — Git velocity | S | 4 | — |
| 8–12 — Query enhancements | S×5 | 5 | 3 (for tag kind lookup) |
| 5 — Call graph | L | 6 | 1 (ParseResult shape) |
| 13 — hasDocstring filter | S | 7 | 1 (description field) |