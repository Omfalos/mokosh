# Test Tag Proposal

Mokosh helps you identify which automated tests are affected by recent code changes, making it ideal for CI/CD pipelines and AI-driven testing.

## How it Works

The tag proposal process follows these steps:

1. **Git Diff Identification**: Mokosh identifies all modified files using `git diff --name-only`, including staged and untracked files.
2. **Feature Hub Detection**: Before traversal, Mokosh identifies *feature hub* files — non-test files that are imported by many others (default threshold: 5 importers). These files get a `feature:<name>` tag.
3. **Reverse Dependency Traversal**: Starting from each changed file, Mokosh traverses the dependency graph **backwards** (from imports to importers).
4. **Hub Short-Circuit**: If traversal reaches a feature hub file, Mokosh adds its `feature:<name>` tag and stops that branch. This prevents an explosion of tags when a core utility changes.
5. **Tag Extraction & Symbol Tracing**: For each affected file in the dependency chain, Mokosh traces which specific symbols are being imported. It only proposes tags from "upstream" files if the symbols exported by the changed file are actually being consumed (or if it's a side-effect import).
6. **Filtering**: Only tags from files identified as "test files" (e.g., `*.test.js`) or nodes categorized as `test` are included in the final proposal.

## Tag Identification Rules

Mokosh automatically extracts tags using several strategies. Not every extracted tag is used
for test selection — see [Tag quality](#tag-quality) below for which ones survive.

### 1. Filename-based Tags
If a file contains `test` or `spec` in its name, it is automatically tagged with `test`
(a `category` marker — it is *not* a selection tag, since every test file carries it).

### 2. Declaration-based Tags
Mokosh records the names of **top-level** functions and variables as `function` / `variable`
tags (declarations nested inside callbacks or test blocks are skipped). These are **not**
used for test selection — a helper name like `makeContext` is not something you grep a
suite by — but they are still visible via `list_tags` with `kind: "function"`.

### 3. `@word` in Test Titles
A `@word` token in a **test title** — the first string argument of `test` / `describe` /
`it` — is extracted as a tag, leading `@` stripped: `test('user login @smoke', …)` → `smoke`.
`@word` tokens in other string literals (import specifiers, `@param`, emails) are ignored —
they are almost never test-selection labels.

### 4. `@tag` Comment Annotations
`@tag <name>` anywhere in the source (JSDoc, inline comments) registers `<name>` as a tag:
```ts
// @tag auth
export function login() { ... }
```

### 5. Graph-Derived Tags (Test Files)
After the dependency graph is fully built, Mokosh enriches every test node with a tag for the
**basename** of each module it imports locally. `config.test.ts` importing `./config.ts` gains
the tag `config` — the "module exercised" signal, and usually a plausible `describe` name.
Imported *symbol* names are not tagged (they are just re-derived identifiers). `@tag`
comment-markers on an imported source file also propagate to the tests that import it.

Generic basenames (`index`, `utils`, `types`, `helpers`, `mock`, `setup`, …) are dropped — see
[Tag quality](#tag-quality).

### 6. Vitest / Playwright Option-Bag Tags
Tags declared in the options argument of `test`, `describe`, or `it` calls are extracted directly:

```ts
// Vitest
test('login', { tags: ['smoke', 'auth'] }, () => { ... });

// Playwright — string or array; leading @ is stripped
test('login', { tag: '@smoke' }, async ({ page }) => { ... });
test('login', { tag: ['@smoke', '@regression'] }, async ({ page }) => { ... });
```

Chained variants like `it.skip(...)` and `describe.only(...)` are also recognised.

## Tag quality

Tags exist to answer **"given this source change, which tests should run?"** — so a tag is
only useful if it is a plausible `vitest --grep` term or native framework tag. `--propose-tags`,
`--apply-tags`, `--list-tags` (default view) and the `tag:` query filter all pass tags through
one shared **selection-tag** test. A tag survives when **all** of:

1. Its kind is `comment-marker` (deliberate `@tag` / option-bag / test-title marker) or
   `import` (module-basename tag). `function` / `variable` (declaration names) and `library`
   (npm package names) are dropped.
2. Its name is a bare identifier (≥ 2 chars, no `@` / `:` / `/`).
3. It is not a bare category echo (`test`, `barrel`).
4. It is not on the built-in **blocklist** of generic names — structural filenames (`index`,
   `main`, `utils`, `types`, `helpers`, `mock`, `setup`, `common`, `shared`, `config`, …),
   ubiquitous code words (`run`, `get`, `set`, `node`, `context`, `handler`, `result`, …) and
   Go build-constraint platform tokens (`linux`, `amd64`, `darwin`, `cgo`, …).

`--list-tags` still exposes everything behind `--tag-kind function` / `--tag-kind all`; only
its default view is filtered.

### Tuning the blocklist

`mokosh.config.json`:

```json
{
  "tags": {
    "blocklist": ["widget", "legacy"],
    "allowlist": ["config"]
  }
}
```

`blocklist` names are added to the built-in list; `allowlist` names are kept even if built-in-
or user-blocked. Both are case-insensitive.

## Feature Hub Detection

When a widely-imported file changes (e.g. `utils.ts` imported by 40 files), traversing all dependents would produce an enormous, noisy tag set. Mokosh avoids this by treating high in-degree files as *feature hubs*.

A hub file:
- Has at least `minInDegree` local importers (default: 5)
- Is not a test file
- Gets an automatic tag: `feature:<basename>` (e.g. `utils.ts` → `"feature:utils"`)

When `proposeTags` encounters a hub during backward traversal, it emits the hub's `feature:` tag and stops traversing further up from that branch. This keeps the output actionable: instead of 40 test tags, you get `"feature:utils"`, signalling that any test covering the utils feature should run.

If the **changed file itself** is a hub, its feature tag is emitted regardless, and traversal continues normally to also capture any directly affected test files.

## CLI Usage

Run the following command to see which tags are affected by your current changes:

```bash
npx mokosh --propose-tags src/tests/e2e.test.ts
```

Output:
```json
{
  "proposedTags": ["smoke", "auth"]
}
```

Use `--feature-threshold` to tune the hub detection sensitivity:

```bash
npx mokosh --propose-tags --feature-threshold 3
```

To see which files are identified as feature hubs without running a tag proposal:

```bash
npx mokosh --detect-features src/index.ts
```

## Affected Test Files (file paths instead of tags)

When you want to run only the affected tests directly — without maintaining tag annotations — use `--affected-tests`. It performs the same symbol-aware graph traversal as `--propose-tags` but returns file paths instead of tag strings:

```bash
npx mokosh --affected-tests
```

Output (plain text, one path per line):
```
src/config.test.ts
src/mcp.test.ts
src/parser.test.ts
```

Pipe directly into Vitest to run only what was touched:

```bash
vitest $(npx mokosh --affected-tests)
```

Or in CI:

```bash
TESTS=$(npx mokosh --affected-tests)
if [ -n "$TESTS" ]; then
  vitest $TESTS
else
  echo "No affected tests found"
fi
```

`--feature-threshold` applies here too — tests beyond a hub boundary are excluded, keeping the list tight even when a widely-imported utility changes.

## Programmatic API

You can use the `proposeTags` and `proposeAffectedTests` functions in your own scripts:

```typescript
import { createImportMap, proposeTags, proposeAffectedTests, getGitDiffFiles } from 'mokosh';

const graph = await createImportMap(process.cwd(), ['src/index.ts']);
const changedFiles = getGitDiffFiles(); // Uses git diff --name-only

// Tag-based: returns strings like ["smoke", "auth", "feature:parser"]
const tags = proposeTags(graph, changedFiles);
console.log('Affected Tags:', tags);

// Path-based: returns strings like ["src/auth.test.ts", "src/parser.test.ts"]
const testFiles = proposeAffectedTests(graph, changedFiles);
console.log('Affected Tests:', testFiles);
```

To customise the feature threshold or disable hub short-circuiting:

```typescript
// Lower threshold — more files treated as hubs
const tags = proposeTags(graph, changedFiles, {
  featureDetection: { minOutDegree: 3 },
});

// Disable hub detection — always traverse all the way to test nodes
const tags = proposeTags(graph, changedFiles, { featureDetection: false });
```

## Why use Test Tags?

- **Faster CI**: Run only the tests that are actually affected by your changes.
- **AI Context**: Provide AI models with a list of relevant test tags to help them understand the impact of proposed code modifications.
- **Better Coverage**: Identify gaps where code changes aren't covered by any tagged tests.
