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

Mokosh automatically extracts tags using several strategies:

### 1. Filename-based Tags
If a file contains `test` or `spec` in its name, it is automatically tagged with `test`.

### 2. Declaration-based Tags
Mokosh treats the names of **top-level** functions and variables as potential tags. Declarations nested inside callbacks, test blocks, or helper functions are excluded to avoid noise (e.g. local variables like `tmpDir` or `unique` inside a `test()` body will not produce tags).

### 3. `@word` in String Literals
Any `@word` pattern inside a string literal is extracted as a tag (leading `@` stripped). This covers test-title conventions like `test('user login @smoke', ...)`.

### 4. `@tag` Comment Annotations
`@tag <name>` anywhere in the source (JSDoc, inline comments) registers `<name>` as a tag:
```ts
// @tag auth
export function login() { ... }
```

### 5. Graph-Derived Tags (Test Files)
After the dependency graph is fully built, Mokosh enriches every test node with tags derived from the basenames of its local imports. For example, `config.test.ts` importing `./config.ts` and `./parser/utils.ts` gains the tags `config` and `utils`. This captures the semantic relationship between a test file and the modules it exercises — without relying on naming conventions inside the file.

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
  "proposedTags": ["smoke", "auth", "login"]
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
