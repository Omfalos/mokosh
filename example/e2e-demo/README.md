# e2e-demo

A small, genuinely runnable multi-framework example: one shared TypeScript
module (`src/cart.ts`) consumed by a vitest unit test, a Playwright spec, and
a Gherkin scenario (via real Cucumber.js step-definitions) — plus an
independent pytest and go test track for language coverage.

It exists to demonstrate, and let CI prove, that when a shared dependency
changes, mokosh's `propose_tags` / `propose_affected_tests` can trace that
change to every kind of test that covers it — and to show exactly where that
breaks down for Gherkin, with two separate causes:

- `tests/cart.test.ts` and `e2e/checkout.spec.ts` both `import ../src/cart`
  directly, so they're reachable by mokosh's incoming-edge traversal and
  correctly picked up out of the box.
- `features/checkout.feature` on its own has **zero** imports — Gherkin has
  no `import` statement — so it can never be reached by that traversal,
  full stop.
- `step-definitions/checkout.steps.ts` *does* `import ../src/cart` (a real
  edge), but that alone still isn't enough: mokosh's built-in test detection
  (`src/parser/classify.ts`) only recognizes `.test.`/`.spec.` filenames and
  jest/vitest/playwright/cypress/@testing-library imports. A `*.steps.ts`
  file importing `@cucumber/cucumber` matches neither, so by default it's
  classified as ordinary logic — not `category: "test"` — and
  `propose_affected_tests` silently skips it despite the import edge being
  there. **`mokosh.config.json`** in this directory fixes exactly that:
  ```json
  { "testPatterns": [".steps."], "testLibraries": ["@cucumber/cucumber"] }
  ```
  With it applied, `step-definitions/checkout.steps.ts` is correctly
  classified as a test node and shows up in `propose_affected_tests` output
  for a `src/cart.ts` change — `features/checkout.feature` itself still
  won't, since it has no edge to be reached by, but its step-definitions
  now stand in as the discoverable proxy.
- `pytest/` and `go/` are a separate, independent pricing example
  (`apply_discount` / `ApplyDiscount`) — deliberately not wired to the TS
  `cart` module, since cross-language imports aren't a thing mokosh resolves.

**Caveat if you're driving this through the MCP server rather than the
CLI**: `clear_cache` invalidates the cached graph but not the session's
already-loaded config (`SessionState.configs`, keyed by root). If you add or
edit `mokosh.config.json` after an earlier `analyze` call on the same root
in the same server session, `clear_cache` + `analyze` will rebuild the graph
but keep applying the *old* config — you need a fresh server session (or a
CLI invocation, which is a fresh process every time) to pick up the change.

## Running

```bash
npm run example:vitest      # vitest unit test
npm run example:playwright  # Playwright spec (no browser install required —
                             # it doesn't request the `page` fixture)
npm run example:gherkin     # Cucumber.js, running the real step-definitions
npm run example:pytest      # requires: pip install pytest
npm run example:go          # requires a Go toolchain
npm run example:e2e-demo    # all five, in sequence
```

All five run in CI as the `examples` job in `.github/workflows/ci.yml` (an
informational smoke check, not a required merge gate).

## Trying the traversal yourself

With the mokosh MCP server (or CLI) pointed at this directory:

```
analyze(root: ".../example/e2e-demo", entryPoints: [
  "src/cart.ts", "tests/cart.test.ts", "e2e/checkout.spec.ts",
  "step-definitions/checkout.steps.ts"
])

propose_tags(changedFiles: ["src/cart.ts"], format: "paths")
# → tests/cart.test.ts, e2e/checkout.spec.ts, step-definitions/checkout.steps.ts
# note: features/checkout.feature will NOT appear — it has no import edge to
# be reached by, regardless of config. (If you're on the MCP server and this
# is the first analyze() call for this root since mokosh.config.json was
# added, it'll pick the config up fine — the stale-config gap only bites on
# a config edit *after* an earlier analyze() in the same session; see above.)
```
