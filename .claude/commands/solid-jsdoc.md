# solid-jsdoc — SOLID Check + JSDoc on Edited Functions

After editing any TypeScript or JavaScript file, apply this skill to every function you touched.

## When required

Run after editing functions in any `.ts`, `.tsx`, `.js`, or `.mjs` file. Apply to:
- New functions you wrote
- Existing functions you modified
- Functions whose signatures you changed

Skip for:
- One-liner arrow functions used inline (callbacks, array methods)
- Test helper functions that are self-evident from the test name
- Auto-generated or machine-emitted code

---

## Step 1 — SOLID audit

For each edited function, check all five principles and flag any violation **before** writing JSDoc.

### S — Single Responsibility
Does this function do exactly one thing? Red flags:
- Function name contains "and", "or", "also"
- More than ~20 meaningful lines
- Multiple unrelated side effects (e.g., parses input AND writes to disk)

**Fix:** extract the second responsibility into a separate function.

### O — Open / Closed
Would adding a new case require editing this function's body? Red flags:
- Switch/if-else dispatching on a type that will grow
- Hardcoded strategy inside the function body

**Fix:** accept a strategy/handler parameter or dispatch via a lookup map.

### L — Liskov Substitution
If the function accepts a base type, does it work correctly with all subtypes without special-casing? Red flags:
- `instanceof` checks to branch on a subtype
- Throwing for certain subtypes that are nominally valid

**Fix:** remove special-casing; rely on polymorphism.

### I — Interface Segregation
Does the function receive an object and use only a small slice of its properties? Red flags:
- Parameter typed as a large interface but only 1–2 fields are read
- Destructuring 2 fields out of a 10-field type

**Fix:** narrow the parameter type to only the fields actually used (structural typing / Pick<>).

### D — Dependency Inversion
Does the function instantiate or directly call concrete dependencies? Red flags:
- `new SomeService()` inside the function body
- Direct `import` of a concrete module whose implementation may vary

**Fix:** accept the dependency as a parameter (inject it).

### Reporting violations

List each violation in a short inline comment block **above** the function, then fix it before writing the JSDoc. If a violation would require significant refactor outside the current task scope, note it as a `// TODO(SOLID-<S|O|L|I|D>):` comment instead of fixing it silently.

Example:
```ts
// TODO(SOLID-S): also handles persistence — extract to a separate writer function
```

---

## Step 2 — Write JSDoc

After any SOLID violations are fixed (or flagged), write a JSDoc block for the function. It must be:

- **Human-readable prose** — written for a developer who has never seen this file
- **One-sentence summary** on the opening line — what the function does, not how
- `@param` for every parameter: type is inferred by TypeScript, so focus the description on **what the value represents** and any non-obvious constraints
- `@returns` describing what the return value means (not just its type)
- `@throws` if the function throws in documented cases
- `@example` if the call site is non-obvious (optional but encouraged for public API functions)

### Tone rules
- Active voice: "Builds the graph" not "The graph is built"
- No implementation details in the summary line
- No restatement of the type ("a string containing…" — just say what it means)
- No filler phrases: "This function…", "Helper that…", "Utility to…"

### Format
```ts
/**
 * <One-sentence summary in active voice.>
 *
 * @param root - <What this path points to and any constraints>
 * @param options - <What the options control>
 * @returns <What the returned value represents>
 * @throws {TypeError} <When and why>
 * @example
 * const result = myFn("/project", { depth: 2 });
 */
```

---

## Step 3 — Self-check before finishing

Before marking the task done, verify:

- [ ] Every edited function has a JSDoc block
- [ ] No JSDoc block restates the TypeScript types without adding meaning
- [ ] Every SOLID violation is either fixed or has a `TODO(SOLID-X):` comment
- [ ] No new SOLID violations were introduced by your edits
- [ ] The file still type-checks (`npm run typecheck` if in doubt)