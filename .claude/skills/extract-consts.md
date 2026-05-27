# extract-consts — Extract Magic Strings to Constants

Extract magic string literals from a given file (or the file currently open / mentioned in context) into a `const.ts` (or `const enum`) in the same folder, then update all usages in the source file to reference the new constants.

## Process

1. **Read the target file** to inventory all magic strings — hardcoded string literals used in comparisons, switch cases, config keys, or repeated across the file.

2. **Classify each string** by its use case:
   - **`const enum`** — a closed set of string tokens used in `switch`/`if` comparisons (e.g. CLI flags, event names, status codes). Prefer this when the set is exhaustive and values are compared with `===`.
   - **`export const`** — a single meaningful string constant that is referenced but not part of an enum group (e.g. a default filename, a directory name, a config key).

3. **Check for an existing `const.ts`** in the same folder. If one exists, append to it rather than creating a new file.

4. **Write (or update) `const.ts`** with the extracted values. Use `const enum` for flag/token groups; `export const` for standalone strings.

5. **Update the source file** to import from `./const` and replace every magic string with the corresponding constant or enum member.

6. **Run `npm run typecheck`** to confirm no new errors were introduced.

## Rules

- Do not extract strings that only appear once and carry no semantic meaning (e.g. a one-off error message).
- Do not extract strings that are part of external APIs or format templates where the literal is intentional.
- Keep enum member names PascalCase; standalone consts SCREAMING_SNAKE_CASE.
- Import path must use `"./const"` (no `.js` extension — the formatter will normalise it).