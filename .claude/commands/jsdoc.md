# jsdoc — AI JSDoc Generator

Add human-readable JSDoc comments to every undocumented function, method, and exported symbol in a TypeScript/JavaScript file.

## Invocation

`/jsdoc [file]` — document the given file, or ask the user which file to document.

## Rules

### What to document
- Every exported function and method
- Every non-exported function that is non-trivial (more than a one-liner)
- Class declarations (description on the class itself; constructor gets @param tags)
- Skip: one-liner arrow functions assigned to a variable, trivial getters/setters, test helpers

### Skip if already documented
If a function already has a `/** ... */` block immediately above it, leave it untouched.

### Style

Use this exact format:

```ts
/**
 * @description What this does and why — explain intent and behaviour, not just
 *   what the code obviously does. One to three sentences.
 * @param name - What this argument represents and any meaningful constraint.
 * @returns What is returned and when it may differ (e.g. null on miss).
 */
```

Rules:
- `@description` is always first and always present
- One `@param` line per parameter, in declaration order
- Omit `@returns` for `void` / `Promise<void>` functions
- For `Promise<T>`, describe the resolved value, not the Promise wrapper
- Descriptions must be genuinely human-readable — no "The foo parameter is the foo." Write what it *means*, not what it *is*
- Keep descriptions concise: prefer one clear sentence over two vague ones

### Process

1. Read the entire file
2. Identify every function/method that needs documentation
3. For each one, infer intent from: the name, parameter names/types, return type, body logic, and how it is called
4. Write the JSDoc block and insert it immediately above the function/method declaration, preserving indentation
5. Do not change any code — only add JSDoc blocks
6. After all edits, run `npm run typecheck` to confirm no type regressions

### End report

List every symbol that was documented (one line each: `symbol name — file:line`).
If every symbol was already documented, say so and do nothing.