# pre-update — Impact-Aware File Update

Before editing any file whose exports other files may depend on, run mokosh to identify every file in the blast radius. The MCP server is always active — use it.

## When required

Use before:
- Renaming or removing an exported symbol, type, or function
- Changing a function signature, return type, or interface shape
- Moving or merging a module
- Changing a shared config or constant

Skip when:
- The change is inside a private (unexported) function
- The file has no internal importers (confirm with `get_dependents`)
- The edit is purely cosmetic

## Workflow

### 1. Identify target files

List every file you plan to change.

### 2. Get the blast radius (one call per target)

```
analyze({ root: "<abs-root>", entryPoints: ["src/index.ts"] })
get_affected({ root: "<abs-root>", file: "<relative-path>" })
```

The `get_affected` result **is** your update list. Every file returned must be reviewed for breakage.

For direct importers only: `get_dependents({ root, file })`.

### 3. Report to the user before editing

List the affected files and confirm scope before writing any code:

> Changing `src/foo.ts` affects N files: `src/bar.ts`, `src/baz.ts`, `src/foo.test.ts`. Proceeding.

If the blast radius is unexpectedly large, pause and ask the user whether to continue.

### 4. Edit in dependency order

Edit leaves first (files with no dependents in the affected set), then files closer to the entry point. This prevents reading a stale version mid-edit.

### 5. Verify after

Re-run `get_affected` or check type errors to confirm nothing was missed.

## Rules

- Never start editing until step 2 is complete.
- Never skip the impact query on the grounds that the change "looks small."
- If `get_affected` returns 0 results, double-check with `get_dependents` — zero may mean the file is a leaf and safe to edit freely.