# Graph Traversal

Mokosh provides two traversal engines on the `Graph` class: one for **import edges** and one for **call edges**.

---

## Import Graph Traversal

### `graph.traverse(startPath, visitor, options?)`

DFS over the import dependency graph. Supports both outgoing (follows what a file imports) and incoming (follows who imports a file).

```typescript
graph.traverse(
  startPath: string,
  visitor: (node: FileNode, depth: number, parentPath: string | null) => void | boolean,
  options?: { maxDepth?: number; direction?: 'outgoing' | 'incoming' }
)
```

- **`startPath`**: project-relative path of the starting node.
- **`visitor`**: called for each visited node. Return `false` to prune that branch (stop descending further).
- **`direction`**: `'outgoing'` (default) follows what a file imports; `'incoming'` follows who imports the file.
- **`maxDepth`**: stops at this many hops from the start node.

### Examples

**Print a dependency tree:**
```typescript
graph.traverse('src/main.ts', (node, depth) => {
  console.log('  '.repeat(depth) + node.path);
});
```

**Find everything that depends on a file (blast radius):**
```typescript
graph.traverse('src/utils/logger.ts', (node) => {
  console.log(node.path);
}, { direction: 'incoming' });
```

**Limit traversal depth:**
```typescript
graph.traverse('src/main.ts', (node, depth) => {
  console.log(node.path);
}, { maxDepth: 2 });
```

**Stop at a boundary (e.g., skip barrel files):**
```typescript
graph.traverse('src/main.ts', (node) => {
  if (node.category === 'barrel') return false; // don't descend into barrels
  console.log(node.path);
});
```

---

## One-hop helpers

### `graph.getNeighbors(path)`

Returns the `FileNode[]` objects that a file directly imports (first-hop outgoing neighbours).

```typescript
const neighbors = graph.getNeighbors('src/main.ts');
for (const n of neighbors) {
  console.log(n.path, n.type);
}
```

### `graph.getCallers(path)`

Returns paths of files whose exported functions **call into** the given file (one-hop call-graph incoming). More precise than `getNeighbors` in reverse — only files with actual runtime call edges, not just imports.

```typescript
const callers = graph.getCallers('src/utils/logger.ts');
console.log('Called by:', callers);
```

---

## Call Graph Traversal

Beyond import edges, Mokosh tracks cross-file function/method calls on `FileNode.callEdges`. The `traverseCalls` method traverses this graph.

### `graph.traverseCalls(startPath, visitor, options?)`

Same signature as `traverse`, but follows `callEdges` instead of import edges.

```typescript
// Find all files that (transitively) call into logger.ts
graph.traverseCalls('src/utils/logger.ts', (node) => {
  console.log('calls logger:', node.path);
}, { direction: 'incoming' });

// Find everything logger.ts calls outward
graph.traverseCalls('src/utils/logger.ts', (node) => {
  console.log('logger calls:', node.path);
}, { direction: 'outgoing' });
```

Call edges are only emitted for non-test TypeScript/JavaScript files. They record the specific function names:

```typescript
// Each CallEdge: { from: string, to: string, toFile: string }
const edges = graph.getCallEdgesFor('src/main.ts');
for (const e of edges) {
  console.log(`${e.from} → ${e.to} (${e.toFile})`);
}
```

---

## Incoming edge index

Both `traverse` (incoming) and `traverseCalls` (incoming) build a reverse-index map lazily on first use and cache it for the lifetime of the `Graph` instance. There is no setup cost — just call them directly.

---

## Unused file detection

```typescript
import { getAllProjectFiles } from 'mokosh';

const allFiles = getAllProjectFiles(rootDir);
const unused = graph.findUnusedFiles(allFiles);
console.log('Not reachable from any entry point:', unused);
```

`findUnusedFiles` compares all files returned by `getAllProjectFiles` against the nodes actually in the graph. Any file present on disk but absent from the graph (not reachable from the entry points) is returned.