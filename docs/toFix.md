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

### 12. Public API surface leaks all internals via `export *` — ✅ Resolved

**File:** `src/index.ts`

**Was:** `export * from "./graph"` and `export * from "./parser"` mass-re-exported every internal type and function.

**Fixed:** `src/index.ts` now uses explicit named exports only — no `export *` anywhere. Each symbol is intentionally surfaced.

---

### 13. Go local-resolution — ✅ Resolved (2026-06-19)

**File:** `src/graph/lang-resolvers/go.ts`

**Was:** The Go parser marked all imports as external. No local edges appeared in the graph.

**Fixed:** Pure filesystem resolution via `go.mod` parsing (see ADR-007):
- All non-test `.go` files in the target package directory are returned as edges (one edge per file), accurately reflecting Go's package-scoped import model.
- `replace` directives (block and single-line form, including version-constrained LHS) are parsed and applied before standard module-prefix resolution.

**Remaining known limitations** (documented in ADR-007; vendor and workspace support deferred):
- `vendor/` directories: third-party packages stored under `vendor/` are still treated as external.
- `go.work` workspaces: multi-module workspace files are not read.

---

### 14. Consolidate overlapping MCP tools — ✅ Resolved (2026-06-19)

**File:** `src/mcp/tools.ts`, `src/mcp/handlers.ts`

**Was:** `get_affected` and `get_change_impact` did the same traversal with different caching strategies. `propose_tags` and `propose_affected_tests` ran the same graph walk and differed only in output format. 20 tools before v1.

**Fixed:**
- Merged `get_change_impact` into `get_affected` via `cached: boolean` parameter (default `false`).
- Merged `propose_affected_tests` into `propose_tags` via `format: "tags" | "paths"` parameter (default `"tags"`).
- Tool count reduced from 20 to 18.

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
| 12 | ✅ Done | `src/index.ts` — all `export *` replaced with explicit named exports | L |
| 13 | ✅ Done | `src/graph/lang-resolvers/go.ts` — pure-FS fix; see ADR-007 | M |
| 14 | ✅ Done | `src/mcp/tools.ts`, `src/mcp/handlers.ts` — merged get_change_impact→get_affected (cached param), propose_affected_tests→propose_tags (format param) | M |
| 15 | P0 | `src/mcp/cache.ts`, all handlers | M |
| 16 | P0 | `README.md`, `docs/prd.md` | S |

**Effort key:** XS < 30 min · S < 2 h · M < 1 day · L multi-day
