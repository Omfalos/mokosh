# ADR-008: Tag Applier Strategy Architecture

**Date:** 2026-07-04
**Status:** Accepted

---

## Context

Mokosh gained an `--apply-tags` command (and `apply_tags` MCP tool) that writes tag annotations into test files based on the dependency graph. The intent is to enable CI/CD pipelines to run only the tests affected by a change:

```bash
# Write tags into test files (run once, commit the result)
mokosh --apply-tags --root .

# In CI: propose tags for changed files, then run only matching tests
TAGS=$(mokosh --propose-tags --plain)
vitest run --include-tags "$TAGS"
```

The initial implementation wrote a custom `// <mokosh-tags>` comment block at the top of every test file. This was revisited for two reasons:

1. **Format mismatch**: Vitest, Playwright, pytest, and `@cypress/grep` each have their own native tag mechanism. Writing a custom comment block ignores that and forces consumers to use `--grep` (test-name pattern matching) rather than the framework's native tag filter.
2. **Language coverage**: The project already parses TypeScript, Python, Go, Gherkin, CoffeeScript, and others. A monolithic applier function cannot cleanly handle all of them — each language uses a different annotation format.

---

## Options considered

### 1. Single function with format detection — rejected

Keep all logic in `applier.ts` with `if/else` branches per language/framework.

**Pros:** simple to understand initially.
**Cons:** grows unbounded as languages and frameworks are added. Each new case requires editing a central file. Testing individual formats is harder because they share mutable state and branching paths. Adding Playwright support alongside Vitest in the same function creates ordering ambiguity.

### 2. Custom `// <mokosh-tags>` comment block for all files — rejected

Write a framework-agnostic comment block into every test file and use `--grep "$TAGS"` in CI.

**Pros:** no per-framework knowledge needed; works with any runner that supports name-pattern filtering.
**Cons:**
- Vitest 4 has `--include-tags` (native tag filter), Playwright has `--grep @tag`, pytest has `-m mark`, `@cypress/grep` has `--env grepTags`. Bypassing these forces teams onto a weaker mechanism.
- Tags in test *names* (for `--grep`) are coarser than tags in test *metadata*; the framework cannot distinguish between a file matching "auth" in its name and a file genuinely tagged `auth`.
- The comment block is invisible to the test framework — IDE integrations, reporters, and coverage tools that are tag-aware cannot use it.

### 3. Strategy pattern with per-language/framework implementations — **chosen**

Define a `TagApplierStrategy` interface and implement it once per target. The registry selects the right strategy per file based on extension (languages) and config (TS/JS framework variant).

---

## Decision

Use a strategy pattern. The tag applier selects the annotation format based on file extension and the `tagApplier.framework` config key.

```
src/tags/strategies/
  types.ts          — TagApplierStrategy interface + TagFramework union type
  ts-ast-utils.ts   — shared TypeScript compiler API helpers
  vitest.ts         — { tags: [...] } in describe/test/it (Vitest 4)
  playwright.ts     — { tag: ["@name"] } in test.describe/test (Playwright)
  cypress.ts        — { tags: ["@name"] } for @cypress/grep
  jest.ts           — /** @group name */ docblock for jest-runner-groups
  pytest.ts         — pytestmark = [pytest.mark.name, ...] at module level
  go.ts             — //go:build mokosh_name || ... before package declaration
  gherkin.ts        — # <mokosh-tags> block with @tagname lines
  index.ts          — createStrategies(defaultFramework), detectFrameworkFromImports(),
                       getStrategyForFile()
```

---

## Strategy interface

```typescript
interface TagApplierStrategy {
  readonly name: string;
  canHandle(absPath: string): boolean;
  apply(absPath: string, source: string, tags: string[]): string;
}
```

`apply` is a pure function: it receives source text and returns the (potentially modified) source text. All file I/O, dry-run logic, and error handling live in the caller (`applyTagsToFile`). This makes each strategy unit-testable without touching the filesystem.

---

## Strategy selection

Two orthogonal axes determine which strategy is used:

**Language** — determined by file extension, always active, no config needed:

| Extension | Strategy | Format |
|-----------|----------|--------|
| `.feature` | `GherkinStrategy` | `@tagname` lines inside `# <mokosh-tags>` block |
| `.py` | `PytestStrategy` | `pytestmark = [pytest.mark.tag, ...]` module variable |
| `*_test.go` | `GoStrategy` | `//go:build mokosh_tag \|\| ...` before `package` declaration |

**Framework** — determined **per file** by import-specifier detection for TS/JS files
(`.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`). `AutoFrameworkStrategy` parses
each file's top-level imports and matches them against a marker table; `tagApplier.framework` in
`mokosh.config.*` is used only as a fallback when no marker import is found (e.g. a file relying
on `globals: true` with no explicit test-library import):

| Import specifier | Framework | Strategy | Format | CI filter |
|---|---|---|---|---|
| `@playwright/test` | Playwright | `PlaywrightStrategy` | `{ tag: ["@tag"] }` with `@` prefix | `playwright test --grep @tag` |
| `cypress` | Cypress | `CypressStrategy` | `{ tags: ["@tag"] }` for `@cypress/grep` | `cypress run --env grepTags=@tag` |
| `@jest/globals` | Jest | `JestStrategy` | `/** @group tag */` docblock (`jest-runner-groups`) | `jest --group=tag` |
| `vitest` | Vitest | `VitestStrategy` | `{ tags: ["tag"] }` in describe/test/it options | `vitest run --include-tags tag` |
| *(none found)* | `tagApplier.framework` default (`"vitest"` if unset) | — | — | — |

This means a single repo can mix Jest unit tests, Playwright/Cypress e2e tests, and Vitest tests,
and each file is tagged in its own framework's native format in one `--apply-tags` run — no
per-project `framework` choice required.

Language strategies are checked first in the ordered list; `AutoFrameworkStrategy` is always
last and handles any remaining TS/JS file. Since language strategies have narrow `canHandle`
predicates (exact extensions), there is no ambiguity.

---

## Format rationale per target

### Vitest — `{ tags: [...] }` in describe/test/it

Vitest 4 reads the `tags` array from the options object passed to `describe`/`test`/`it`. The `--include-tags` and `--exclude-tags` CLI flags filter by this metadata, not by test names. Tags are injected into top-level calls only (nested describes inherit from their parent). Vitest 4 validates that tags are declared in the project config by default; `strictTags: false` in `vitest.config.ts` disables this requirement, allowing mokosh to inject arbitrary tags without maintaining a static allowlist.

### Playwright — `{ tag: ["@tag"] }` with `@` prefix

Playwright uses the singular key `tag` (not `tags`) with the `@` prefix convention (e.g. `@smoke`, `@auth`). The `--grep @tag` flag filters tests by this metadata. The strategy normalises tags by stripping the `@` prefix for comparison with mokosh's unprefixed tag names and re-adding it on write.

### Cypress — `{ tags: ["@tag"] }` for `@cypress/grep`

`@cypress/grep` is a first-party Cypress plugin that adds tag-based test selection. It uses the same `tags` key as Vitest but with the `@` prefix convention shared with Playwright. Requires `npm install --save-dev @cypress/grep` and a setup import in `cypress/support/e2e.ts`.

### Jest — `/** @group tag */` docblock

Jest has no built-in tag/grep mechanism. `jest-runner-groups` is the de-facto community standard: it reads a `@group` docblock pragma above a test file's imports and filters with `jest --group=tag`. The strategy writes/updates a single docblock at the top of the file; removing all tags removes the block entirely. Requires `npm install --save-dev jest-runner-groups` and `runner: "jest-runner-groups"` in the Jest config.

### pytest — `pytestmark` module variable

`pytestmark` is a pytest built-in: assigning a list of marks to this module-level variable applies those marks to every test in the file. This is the recommended pytest way to mark an entire file without decorating individual test functions. The strategy injects or updates one line; `import pytest` is added when absent.

### Go — `//go:build` with `mokosh_` prefix

Go has no runtime test-tag system. Build tags (`//go:build`) are the closest mechanism — they control which files are compiled into the test binary. The `mokosh_` prefix avoids colliding with existing build tags (e.g. `linux`, `integration`). The `||` (OR) operator means the file is included when *any* of the listed tags is active, matching the "run tests related to this change" intent. Teams using this approach run `go test -tags mokosh_auth ./...` in CI.

### Gherkin — `# <mokosh-tags>` comment block

Gherkin `.feature` files already use `@tag` lines before `Feature:` / `Scenario:` as native annotations. The strategy writes mokosh-computed tags inside a delimited `# <mokosh-tags>` / `# </mokosh-tags>` block so they can be distinguished from manually written tags and updated idempotently without overwriting hand-authored annotations.

---

## Idempotency

Every strategy's `apply` method compares the sorted computed tags against any tags already present in the file. If they match, `apply` returns the source unchanged. The caller detects this by comparing the return value to the input with `===`. Running `--apply-tags` twice in a row always produces `{ updated: 0, unchanged: N }` on the second run.

Legacy `// <mokosh-tags>` comment blocks (from the pre-strategy implementation) are stripped by the Vitest strategy as a one-time migration step.

---

## Configuration

```json
// mokosh.config.json
{
  "tagApplier": {
    "framework": "playwright",
    "frameworkOverrides": {
      "tests/e2e/**": "playwright",
      "tests/unit/**": "jest"
    }
  }
}
```

`tagApplier.framework` is a fallback, not a project-wide switch: it only applies to TS/JS files
where import-specifier detection finds no known framework import. When `tagApplier` is absent,
the fallback is `"vitest"`. Language strategies (Python, Go, Gherkin) require no configuration —
they are active whenever files with the relevant extension exist in the graph.

`tagApplier.frameworkOverrides` narrows that fallback by path: it maps glob patterns
(project-relative, matched in object key order, first match wins) to a framework, and is
consulted after import detection but before the scalar `framework` default. This covers repos
where different directories use different frameworks purely via `globals: true` (no explicit
import in either) — e.g. Playwright e2e tests under `tests/e2e/` and Jest unit tests under
`tests/unit/`, neither of which can be told apart by import scanning alone.

---

## Consequences

**Positive**
- Each strategy is a small, independently testable unit with no shared mutable state.
- Adding support for a new framework requires one new file in `src/tags/strategies/` (implementing `TagApplierStrategy`), one line in `FRAMEWORK_STRATEGIES`, and one marker entry in `FRAMEWORK_IMPORT_MARKERS` in `index.ts` — no changes to the applier or any consumer. Jest (`jest-runner-groups` `@group` docblocks) was added this way.
- Native test-framework tag semantics are preserved: reporters, IDE integrations, and coverage tools that are tag-aware can use the annotations directly.
- CI filtering uses the framework's own flag (`--include-tags`, `--grep`, `-m`, `--group`) rather than a string-match workaround.
- Per-file import detection means a project mixing Jest, Vitest, Playwright, and Cypress tests in the same repo is tagged correctly in one `--apply-tags` run — no single `framework` choice required, and no path-convention configuration to maintain.

**Negative**
- Vitest 4 requires `strictTags: false` in `vitest.config.ts` to allow tags that are not pre-declared in the config. This is a one-line opt-in but is a non-default Vitest setting.
- Go's `//go:build` approach changes compilation units, not just test selection. A file tagged `//go:build mokosh_auth` is excluded from the default `go test ./...` run unless `-tags mokosh_auth` is passed. Teams should understand this trade-off; the alternative (a comment-only approach mokosh reads but Go ignores) would require a separate mokosh config mechanism to map tags to `-run` patterns.
- Detection relies on a static import-specifier scan of top-level imports. A file that uses a framework purely via globals (`globals: true`, no explicit import) falls back to `tagApplier.frameworkOverrides` (if its path matches a configured glob) or otherwise `tagApplier.framework` — the scalar default still applies project-wide unless `frameworkOverrides` narrows it by path.
