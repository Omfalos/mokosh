# Known Issues & Actionable Fixes

Findings from a full MCP tool audit and AI/senior/staff engineering assessment (2026-06-13).

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

---

## P0 — Pre-publish blockers (architect review, 2026-06-15)

### 12. Public API surface leaks all internals via `export *`

**File:** `src/index.ts`

**Symptom:** `export * from "./graph"` and `export * from "./parser"` mass-re-export every internal type and function. Anything exported without `@internal` becomes semver-protected at v1. This makes API stabilisation and future refactors extremely painful.

**Fix:**
- Audit every symbol currently re-exported; tag each as `@public`, `@beta`, or `@internal` in JSDoc.
- Replace `export *` with explicit named exports for the stable public surface only.
- Keep internal types accessible for testing via deep imports (`mokosh/internal`) guarded by a `@internal` convention.

---

### 13. Go local-resolution is silently wrong

**File:** `src/graph/lang-resolvers/go.ts`, `README.md`

**Symptom:** The Go parser treats all imports as external, including intra-project packages. The dependency graph for Go projects contains no local edges — the tool gives confidently wrong structural output without any warning.

**Fix (choose one):**
- **Remove Go from supported languages** until proper resolution is implemented.
- **Warn loudly**: add `"warning": "Go local package resolution is not supported — all imports are classified as external"` to every `analyze` response when Go files are present.
- **Implement correctly** via `go list -json ./...` subprocess (noted in roadmap as the right approach).

---

### 14. Consolidate overlapping MCP tools

**File:** `src/mcp/tools.ts`, `src/mcp/handlers.ts`

**Symptom:** `get_affected` and `get_change_impact` do the same traversal with different caching strategies. `propose_tags` and `propose_affected_tests` run the same graph walk and differ only in output format. 20 tools before v1 increases cognitive overhead for AI agents and maintenance surface for maintainers.

**Fix:**
- Merge `get_change_impact` into `get_affected` with a `cached: true` parameter.
- Merge `propose_affected_tests` into `propose_tags` with a `format: "paths" | "tags"` parameter.
- Target: ~12 tools at v1.

---

### 15. Stale cache has no query-time detection

Already tracked as **#5** above — promoted to P0 because it produces wrong answers silently, which is the highest-risk failure mode for an AI-facing tool. See #5 for the fix.

---

### 16. No competitive positioning statement

**File:** `README.md`, `docs/prd.md`

**Symptom:** The README does not answer "why not use Sourcegraph or GitHub Copilot Workspace instead?" Without this, adoption by teams who already have those tools is blocked. The PRD still describes Mokosh as a "frontend-focused" tool despite supporting 10 languages.

**Fix:**
- Add a "Why Mokosh?" section to the README: local-first, no data leaves the machine, works offline, integrates in 5 minutes via MCP, no vendor lock-in.
- Update the PRD problem statement to reflect the actual product scope.

---

## Summary table

| # | Priority | File(s) | Effort |
|---|----------|---------|--------|
| 5 | P2 | `mcp/cache.ts`, all handlers | M |
| 6 | P2 | `tags/proposer.ts`, `mcp/handlers.ts` | M |
| 7 | P2 | `mcp/cache.ts`, `mcp/handlers.ts` | S |
| 8 | P2 | `mcp/handlers.ts:279` | XS |
| 9 | P3 | `cli/commands/affected-tests.ts`, docs | L |
| 10 | P3 | `mcp/tools.ts` (descriptions) | XS |
| 11 | P3 | `mcp/handlers.ts:115` | S |
| 12 | P0 | `src/index.ts` | L |
| 13 | P0 | `src/graph/lang-resolvers/go.ts`, `README.md` | M |
| 14 | P0 | `src/mcp/tools.ts`, `src/mcp/handlers.ts` | M |
| 15 | P0 | `src/mcp/cache.ts`, all handlers | M |
| 16 | P0 | `README.md`, `docs/prd.md` | S |

**Effort key:** XS < 30 min · S < 2 h · M < 1 day · L multi-day
