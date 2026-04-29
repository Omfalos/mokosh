# Graph Traversal

Mokosh provides a powerful traversal engine to explore the dependency graph.

## Depth-First Traversal

The `traverse` method allows you to visit nodes starting from a specific file.

### API Signature

```typescript
graph.traverse(startPath: string, visitor: TraversalVisitor, options: TraversalOptions);
```

### Parameters

- **`startPath`**: The relative path to the node where the traversal should begin.
- **`visitor`**: A function called for each node visited.
  ```typescript
  (node: FileNode, depth: number) => void | boolean;
  ```
  If the visitor returns `false`, the traversal will stop exploring that branch.
- **`options`**: (Optional)
  - `maxDepth`: Maximum number of levels to descend.
  - `direction`: `'outgoing'` (default).

### Example: Printing a Dependency Tree

```typescript
const graph = createImportMap(process.cwd(), ['src/main.ts']);

graph.traverse('src/main.ts', (node, depth) => {
  const indent = '  '.repeat(depth);
  console.log(`${indent} ${node.path} (${node.type})`);
});
```

### Example: Limiting Depth

```typescript
graph.traverse('src/main.ts', (node, depth) => {
  console.log(`Checking: ${node.path}`);
}, { maxDepth: 2 });
```

### Example: Conditional Traversal

```typescript
graph.traverse('src/main.ts', (node, depth) => {
  if (node.path.includes('node_modules')) {
    return false; // Skip node_modules branches
  }
  console.log(`Processing: ${node.path}`);
});
```

## Neighbor Lookup

If you only need immediate dependencies, use `getNeighbors`.

```typescript
const neighbors = graph.getNeighbors('src/main.ts');
neighbors.forEach(n => console.log(`Imports: ${n.path}`));
```
