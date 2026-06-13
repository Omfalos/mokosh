# Known Issues & Actionable Fixes

Findings from a full MCP tool audit and AI/senior/staff engineering assessment (2026-06-13).

---

## P0 — Bug

### 1. Call edge collection misses class methods

**Files:** `src/parser/lang/typescript.ts:502` (`collectRawCallEdges`), `src/graph/builder.ts`

**Symptom:** `get_callers` and `get_call_graph` return zero callers for any file whose consumers call it from inside a class method. For example, `src/parser.ts` shows 0 callers despite being called by `GraphBuilder.tryParse()` in `src/graph/builder.ts`.

**Root cause:** `getTopLevelExportedFunctionName` (line 536) only matches `export function foo` and `export const foo = () => ...` at the top level. Class methods (`export class Foo { bar() { ... } }`) are never walked, so files that are primarily class-based produce zero call edges.

**Fix:**
- Extend `collectRawCallEdges` to also walk `ClassDeclaration → MethodDeclaration` bodies.
- Attribute edges as `ClassName.methodName` for the `from` field.
- Add a regression test: a file exporting a class whose method calls an imported function must produce call edges.

---

## P1 — Correctness / trust issues

### 2. Cycles in `src/graph/lang-resolvers/`

**Files:** `src/graph/lang-resolvers/index.ts`, `src/graph/resolver.ts`, `src/graph/lang-resolvers/go.ts`, `src/graph/lang-resolvers/lua.ts`, `src/graph/lang-resolvers/python.ts`

**Symptom:** `analyze` always reports four cycles involving `lang-resolvers/index.ts ↔ resolver.ts` and `index.ts ↔ {go,lua,python}.ts`. A tool whose primary feature is cycle detection should not have cycles in its own source.

**Fix:**
- `resolver.ts` should not import from `lang-resolvers/index.ts`.
- The index should only aggregate resolvers; the thing it aggregates should not import back from it.
- Break the cycle by injecting resolvers via a registry or constructor parameter rather than a static import.

---

### 3. `privateFiles` label in `get_api_surface` is misleading

**File:** `src/mcp/handlers.ts:549`, `src/graph/api-surface.ts`

**Symptom:** `get_api_surface` returns `src/cli/` and `src/mcp/` under `privateFiles`. These are major consumers of the library, not dead code. Anyone skimming the output will incorrectly flag them for deletion.

**Fix:**
- Rename the field to `unreachableFromEntry` (or `separateConsumers`).
- Or add a `note` alongside: `"files not reachable from the given entry points — may be separate consumers, not dead code"`.

---

### 4. `find_uncovered` returns noise when no coverage report is configured

**File:** `src/mcp/handlers.ts:277–281`

**Symptom:** Without a `coverageReportPath` in `mokosh.config`, every file returns `coveragePct: null`. Line 279 treats `null` as `0%` (`n.coveragePct ?? 0`), so all 97 non-test files appear "uncovered". The output looks like a real finding but is entirely meaningless.

**Fix (two parts):**
- Line 279: exclude nodes where `coveragePct` is `null`/`undefined` before the threshold check — do not coerce to 0.
- If `coverageMap` is empty (no report loaded), return early with `{ error: "No coverage data available. Set coverageReportPath in mokosh.config and run analyze again." }` rather than a misleading file list.

---

## P2 — Usability / reliability

### 5. Stale graph cache has no detection or warning

**File:** `src/mcp/cache.ts`, all query handlers

**Symptom:** Editing source files mid-session then querying `get_affected` or `get_dependencies` returns silently stale results. There is no indication the graph is out of date. A misremembered `clear_cache` call produces confidently wrong answers.

**Fix:**
- Include `graphBuiltAt` (ISO timestamp) in every query response so callers can judge staleness.
- On each tool call, spot-check `mtime` of 5–10 randomly sampled nodes against the filesystem; if any differ, add `"warning": "graph may be stale — call clear_cache if source files changed"` to the response.

---

### 6. `propose_tags` output volume is unusable

**File:** `src/mcp/handlers.ts:292–301`, `src/tags/proposer.ts`

**Symptom:** With a large diff (the current branch), `propose_tags` returns 120+ tags. Neither an AI assistant nor a CI system can act on this — the hard part (ranking) is left to the consumer.

**Fix:**
- Add a `topTags` field (top 10) ranked by coverage: tags that cover the most changed files via the shortest graph path rank highest.
- Make `topTags` the primary output; keep the full list under `allTags` for completeness.
- Add a `limit` parameter so callers can cap the response.

---

### 7. Workspace tool error does not explain the `entryPoints: []` requirement

**File:** `src/mcp/cache.ts` (`requireWorkspace`), `src/mcp/handlers.ts:394–425`

**Symptom:** Calling `get_workspace_packages` or `get_workspace_affected` after `analyze` with explicit entry points errors with `"No workspace graph cached for this root. Call 'analyze' first."` — which is technically true but completely unhelpful. The user already called `analyze`.

**Fix:**
- In `requireWorkspace`, detect that a single-package graph (not a workspace graph) is cached for `root` and return: `"Single-package graph found. Call analyze with entryPoints: [] to trigger monorepo auto-detection."`.
- In the `analyze` response when entry points are provided, include `"workspaceFeaturesAvailable": false` as a hint.

---

### 8. `find_uncovered` `null` entries pollute the uncovered list (same root as #4, separate fix)

**File:** `src/mcp/handlers.ts:279`

```ts
// Current — wrong
.filter((n) => (n.coveragePct ?? 0) < threshold)

// Fix
.filter((n) => n.coveragePct !== null && n.coveragePct !== undefined && n.coveragePct < threshold)
```

Separate ticket from #4 because it is a one-line fix independent of the early-return behaviour.

---

## P3 — Strategic gaps

### 9. No CI integration story for `propose_affected_tests`

**Symptom:** The tool returns a file path list but there is no documented or CLI-supported path to a test runner invocation. Users must wire it manually every time.

**Fix:**
- Add `--format vitest` / `--format jest` / `--format raw` to the CLI's `--affected-tests` command to emit a ready-to-run shell snippet.
- Add a GitHub Actions example to `docs/usage.md` showing the full `mokosh → vitest` pipeline.

---

### 10. Call edge coverage limitations are undocumented

**Symptom:** Users calling `get_callers` or `get_call_graph` and receiving empty results have no way to know whether "0 callers" means the truth or a data gap (class methods, callbacks, dynamic dispatch).

**Fix (even before #1 is fully resolved):**
- Add to the `get_callers` and `get_call_graph` tool descriptions: `"Call edges are extracted only from top-level exported functions. Class methods, nested functions, and callbacks are not tracked."`
- After fixing #1, update the caveat to reflect remaining limitations (callbacks, dynamic dispatch).

---

### 11. `analyze` with empty `entryPoints` on a non-monorepo falls through silently

**File:** `src/mcp/handlers.ts:115–131`

**Symptom:** On a non-monorepo project, `analyze` with `entryPoints: []` detects `layout.type === "none"` and falls through to build a graph with zero entry points — which results in only test files being included. No error or warning is returned.

**Fix:**
- When `entryPoints` is empty and no monorepo is detected, return an error: `"No monorepo detected and no entry points provided. Pass at least one entry point (e.g. ['src/index.ts'])."`.

---

## Summary table

| # | Priority | File(s) | Effort |
|---|----------|---------|--------|
| 1 | P0 bug | `parser/lang/typescript.ts` | M |
| 2 | P1 | `graph/lang-resolvers/` | M |
| 3 | P1 | `graph/api-surface.ts`, `mcp/handlers.ts` | S |
| 4 | P1 | `mcp/handlers.ts` | S |
| 5 | P2 | `mcp/cache.ts`, all handlers | M |
| 6 | P2 | `tags/proposer.ts`, `mcp/handlers.ts` | M |
| 7 | P2 | `mcp/cache.ts`, `mcp/handlers.ts` | S |
| 8 | P2 | `mcp/handlers.ts:279` | XS |
| 9 | P3 | `cli/commands/affected-tests.ts`, docs | L |
| 10 | P3 | `mcp/tools.ts` (descriptions) | XS |
| 11 | P3 | `mcp/handlers.ts:115` | S |

**Effort key:** XS < 30 min · S < 2 h · M < 1 day · L multi-day
