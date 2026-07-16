# rename-singles — Rename Single-Letter Identifiers

Find every single-letter variable, argument, or constant in a target file (or the files mentioned in context) and rename them to human-readable names. Also covers a curated denylist of specific 2-3 char abbreviations (`.claude/hooks/rename-singles-check.sh` `DENYLIST` array) known to be unclear out of context — e.g. `wg` for `WorkspaceGraph`. This is **not** a length-based rule: most short names in this codebase (`abs`, `dir`, `ext`, `rel`, `pkg`, `src`, `raw`, `ctx`, `arg`, `key`, `map`, `hub`, `sig`, `ret`, `fn`, `doc`, `git`, `pct`, …) are established, self-explanatory conventions and should never be flagged or renamed. Add an abbreviation to the denylist only after a specific instance is found genuinely unclear in review — don't add it speculatively.

## When to use

- After `/pre-update` flags a file for editing — run this first so the rename propagates with the rest of the blast-radius update.
- When reviewing any file that feels hard to read due to opaque identifiers.
- Always run this before committing a new function whose parameters are single letters.

## Process

### 1. Identify the target file(s)

Use the file mentioned in context. If none is specified, ask the user.

### 2. Check the blast radius before touching anything

Because renaming an exported or widely-used identifier can break callers, run pre-update impact check first:

```
get_affected({ root: "<abs-root>", file: "<relative-path>" })
```

Report the affected files. If the radius is larger than expected, confirm with the user before proceeding.

### 3. Find all single-letter identifiers in the file

Scan for:
- **Function/method parameters**: `(a, b, c)`, arrow functions `(x) =>`, destructured `{ a, b }`
- **`let` / `const` / `var` declarations**: `const x = …`, `let i = …`
- **Loop variables**: `for (let i …)`, `for (const k of …)`
- **Catch bindings**: `catch (e)`

**Exclude** the following — they are idiomatic and should NOT be renamed:
- `i`, `j`, `k` used as numeric loop counters in a classic `for (let i = 0; …)` loop
- `_` used as a discard placeholder (e.g. `(_, value) => …`)
- Single-letter type parameters in generics (`T`, `K`, `V`, `E`, `R`) — TypeScript convention

### 4. Infer a good name for each identifier

Use all available context to choose the name:
- The surrounding variable usage (what it's passed to, what property is accessed on it)
- The parameter position in a known function signature
- The type annotation if present
- The enclosing function name and domain

Prefer concrete nouns over generic ones: `node` not `item`, `filePath` not `value`, `importEdge` not `data`.

### 5. Confirm the rename plan with the user

Before writing any code, list every rename as a table:

| Location | Current | Proposed |
|----------|---------|----------|
| `src/foo.ts:12` | `e` | `importEdge` |
| `src/foo.ts:34` | `n` | `node` |

Ask for approval or corrections. Do not proceed without explicit confirmation.

### 6. Apply renames with pre-update discipline

Apply renames in the order dictated by `/pre-update` (leaves first). For each rename:

1. Rename the identifier at its definition site.
2. Update every reference in the same file.
3. If the identifier is exported or used across files (shown in blast radius), update all callers in the affected set.

### 7. Run typecheck

```bash
npm run typecheck
```

Fix any errors before reporting done. Do not claim success until typecheck passes.

## Rules

- Never rename without user confirmation (step 5).
- Never rename without first checking blast radius (step 2).
- Never rename idiomatic single-letters (`i`, `j`, `k`, `_`, type params).
- Keep proposed names in the same casing style as the surrounding code (camelCase for variables, PascalCase for types).
- If the inferred name is ambiguous, offer two options and let the user choose.