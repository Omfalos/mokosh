# MCP tool audit — correctness & token cost

**Date:** 2026-09-10
**Target:** the mokosh repo itself (`analyze` entry points `src/index.ts`, `src/cli.ts`, `src/mcp.ts`)
**Graph:** 381 nodes — logic 158, test 140, other 53, barrel 17, type-only 12, config 1; 0 cycles; TS fidelity `full`.
**Method:** every MCP tool invoked once with representative arguments; responses measured at `bytes ÷ 4` for a token estimate.

Every tool returned a usable response. Nothing crashed. The issues below are correctness bugs, output-quality bugs, and unbounded response sizes.

---

## Part 1 — Correctness / quality findings

### F1 — `get_affected` with `testsOnly:true` leaks non-test files

**Severity:** medium · **Confirmed**

`get_affected({ file: "src/types/node.ts", testsOnly: true })` returns 94 entries — 93 test files plus **`src/parser/lang/python.ts`** (`category: "logic"`, exports `parsePython`), the only non-test file in the list.

**Root cause:** `src/graph/queries.ts:101`

```ts
const isTest = node.category === "test" || node.tags.some((tag) => tag.name === "test");
```

The predicate trusts *any* tag literally named `test`, regardless of tag kind. `list_tags` reports `{"name":"test","count":149}` — nine more than the 140 test files — so ~9 non-test nodes carry a `test`-named tag (a `declaration` / `marker` / `option-bag` tag harvested from an identifier, call, or string literal named `test` in the source). `src/parser/lang/python.ts` is one of them.

**Fix options:**
- Filter on `node.category === "test"` only, or
- Restrict the tag check to `tag.kind === "marker"` (the kind that actually denotes a test marker), or
- Reuse the classify layer's test-path check (`isTestPath` / `getTestPatterns`) instead of a tag-name string match.

**Also audit:** anything else that keys off a bare `tag.name === "test"` — `get_affected`, `propose_tags`, `apply_tags` target selection, `find_uncovered` exclusion.

---

### F2 — Markdown doc-reference edges pollute `detect_features` and `get_feature_graph`

**Severity:** medium · **Confirmed**

`detect_features` ranks documentation files as top "feature hubs / orchestrators":

| Rank | Path | outDegree |
|---|---|---|
| 4 | `README.md` | 31 |
| 5 | `CLAUDE.md` | 27 |
| 6 | `docs/architecture.md` | 23 |
| 8 | `docs/known_issues/07-per-language-analysis-semantics.md` | 21 |
| 9 | `docs/mcp.md` | 19 |

`get_feature_graph` is worse: the hub **`docs/known_issues/README.md`** is assigned **ownership of real source files** — `src/cli.ts`, `src/mcp.ts`, `src/mcp/server.ts`, and every `src/cli/commands/*.ts`. Meanwhile genuine code hubs (`src/index.ts`, `src/parser.ts`, `src/graph/builder.ts`, …) come back with `files: []` because the "most specific hub wins" rule routes their files to whichever doc mentions them.

**Root cause:** `src/graph/features/index.ts`

- `buildOutDegreeMap` (line 38) counts `node.imports.filter((imp) => imp.toPath && !imp.isExternal)`. Markdown → code path-mention edges (from `src/parser/lang/markdown.ts`, resolved by `MarkdownLangResolver`) have a real `toPath` and are not external, so `README.md` scores out-degree 31.
- The hub-candidacy filter (line 63) only excludes `category === "test"` and `category === "barrel"`. Markdown nodes are `category: "other"` (the 53 "other" nodes are 48 `.md` + 5 unknown), so they pass.

**Fix:** exclude documentation nodes from hub candidacy and from the owned/unassigned assignment. Either:
- skip `node.category === "other"` / `node.type === "markdown"` in `detectFeatures`, `buildFeatureGraph`, and `collectUnassigned`, or
- exclude edges whose `from` or `to` node is markdown when building the out-degree map used here.

There is precedent: `analyze` already filters `docReference` edges out of cycle detection (the `cycleKinds` option re-adds them). The feature layer should apply the same exclusion.

---

### F3 — `get_workspace_affected` returns misleading success on a non-monorepo

**Severity:** low · **Confirmed**

On this single-package repo:

- `get_workspace_packages` → **errors** cleanly: `"… is not a recognized monorepo root (no pnpm/npm/yarn/Nx/Turborepo/Gradle/sbt workspace detected)."`
- `get_workspace_affected({ file: "src/parser.ts" })` → `{"totalAffected":0,"packageCount":0,"byPackage":[],"truncated":false}` — a success shape that reads as "nothing depends on this file."

**Fix:** `get_workspace_affected` (and any other workspace-only tool) should throw the same "not a monorepo root / call analyze with empty entryPoints" error as `get_workspace_packages` when no `WorkspaceGraph` is present.

---

### F4 — `analyze` with `entryPoints: []` silently falls back on a non-monorepo

**Severity:** informational

The tool description says empty `entryPoints` triggers monorepo auto-detection. On a non-monorepo it silently builds the normal single-package graph (381 nodes) instead of erroring or reporting "no workspace detected, built single package." Acceptable behaviour, but undocumented — worth a one-line note in the tool description and/or an `isMonorepo: false` marker in the response.

---

### Minor correctness notes

- **`get_api_surface` `unreachableFromEntry`** mixes genuinely unreachable code (`src/parse-worker.ts`, loaded dynamically by piscina) with non-code files (`.md`, `.json`, `tsconfig.json`, `.junie/memory/*.md`). This is the one list in the summary meant to be directly actionable; non-source files should be partitioned out.
- **`apply_tags` with `dryRun: true`** reports `"updated": 105` and `"status": "updated"` per file. Output is correct but the wording implies writes occurred; use `"wouldUpdate"` / a `dryRun` echo in the payload.

---

## Part 2 — Token-cost findings

Default response sizes, measured this run:

| Tool | ~tokens | Bounded by default? |
|---|---:|---|
| `list_tags` | **~7,000** | ❌ 1,214 tags, no `limit`, no `minCount`, no paging |
| `get_feature_graph` (no args) | **~2,800** | ❌ every owned path + ~130-entry `unassigned` array |
| `get_type_graph` (inventory, no `type`) | **~2,400** | ❌ 141 types, full multi-line JSDoc each |
| `apply_tags` (incl. `dryRun`) | **~1,950** | ❌ always echoes all 140 files + per-file status |
| `get_affected` (hub file, `withMeta`) | ~1,400 | ⚠️ paths bounded; per-node `exports[]` uncapped |
| `get_affected` / `get_dependents` (plain) | ~1,000–1,300 | ⚠️ one path per line, scales with blast radius |
| `get_module_responsibility` (no `paths`) | ~1,000+ | ❌ returns all 381 files |
| `get_api_surface` (summary) | ~900 | ✅ capped 30 exports / 50 unreachable + `view` |
| `find_duplicates` (summary) | ~850 | ✅ summary + 8-cluster preview + `hint` |
| `compare_branches` (summary) | ~650 | ✅ verdict + capped deltas + `detail:"full"` |
| `detect_features` | ~600 | ⚠️ no `limit`; count unbounded |
| `check_doc_drift` | ~580 | ⚠️ scales with stale-doc count |
| `query` (slim, 4 nodes) | ~375 | ⚠️ slim drops edges but export-name arrays uncapped |
| `analyze`, `find_unused`, `find_symbol`, `find_complex_functions`, `find_uncovered`, `find_risk_hotspots`, `get_callers`, `get_call_graph`, `clear_cache` | <300 | ✅ naturally small |

### T1 — `list_tags` is the worst offender (~7k tokens / ~28 KB)

1,214 distinct tags, dominated by single-occurrence declaration names (`makeNode`, `noop`, `seg`, `x`, bare filenames like `node.ts`). The `/mokosh` skill instructs the model to call this "before querying with `tag:<name>`" — a 7k-token tax on tag discovery, every session.

**Fix:** add `minCount` (default ≥ 2) and/or `limit`; and/or exclude `declaration`-kind names by default, returning only `marker` / `comment-marker` / `import` tags (the kinds `query` slim mode already keeps). Offer `kind` filter to opt back in.

### T2 — No summary-first mode where siblings have one

`find_duplicates`, `get_api_surface`, and `compare_branches` all ship capped summary defaults with a `view` / `detail` escalation. These do not, and should:

- `list_tags` — see T1.
- `get_feature_graph` — default to `{ hub, outDegree, fileCount }` per domain + `unassignedCount`; opt-in `view:"full"` for the path lists. (Also fixes T3.)
- `get_type_graph` inventory — add `slim` / drop-doc mode, or truncate each `doc` to its first line; add `limit`.
- `get_module_responsibility` with no `paths` — cap to feature-hub files by default, or require `paths`, or paginate.
- `apply_tags` — add a counts-only response (`{ updated, unchanged, errors }`) with the file list behind `verbose:true`.

### T3 — `get_feature_graph` is pitched as the cheap option but isn't here

Skill text: "substantially smaller than a full graph query." On this repo the no-arg call is ~2,800 tokens — larger than `query` slim for most subsystem questions — because it enumerates every owned path plus a ~130-entry `unassigned` list. Compounded by F2. A summary mode (hub names + counts) fixes both.

### T4 — `get_type_graph` inventory inflates on JSDoc

141 types is fine; embedding each type's full multi-line `doc` (5–10 lines for some) roughly triples the payload. Truncate to first line in inventory mode; keep full `doc` only in the focused single-type response.

### T5 — Uncapped nested arrays inside otherwise-bounded responses

- `query` slim mode caps nothing on `exports` / `importsFiles`. `src/mcp/handlers.ts` dumped 50+ export names in one node.
- `get_affected` / `get_dependents` with `withMeta` do the same per result.
- Suggested: cap array previews (e.g. first 15 + `+N more`) in slim/meta modes.

### T6 — `analyze` repeats `languageCoverage` on every call

The ~600-char fidelity matrix is returned on every `analyze`, including re-analyze / cache-hit. Return it once (first build) or move it behind a flag.

---

## Part 3 — Value case: mokosh vs. no mokosh

Repo size: **188 non-test source files, 26,458 LOC, ~1.13 MB ≈ 282,000 tokens** to read in full (with tests: ~485k). A full read does not fit in a 200K context window.

| Question | mokosh | Read + Grep | Ratio |
|---|---:|---:|---|
| Blast radius of `resolver.ts` (124 files, transitive) | ~1,300 | ~25–40k (recursive grep + read every barrel to trace re-exports; still misses dynamic imports) | ~25× |
| Most complex functions | ~900 | ~282k (no metric from grep; read all, eyeball) | ~300× / not viable |
| Duplicated code | ~850 | ~282k, unreliable | impossible → possible |
| Unused files | ~30 | ~282k (build reachability by hand) | impossible → possible |
| Public API surface | ~900 | ~20–35k (read `index.ts` + follow ~20 `export *` chains) | ~25× |
| Who calls `parseFile` | ~90 | ~6–10k (grep 15 hits, read each to classify) | ~80× |
| Module responsibility map | ~8–10k | ~75k (read every file header) | ~8× |
| Branch compare vs HEAD~3 with metric deltas | ~650 | hundreds of k (recompute metrics on both refs) | impossible → possible |
| "What does this 20-line function do" | ~300 + analyze | ~300 (just Read) | break-even / mokosh worse |
| Find files with a known tag | `list_tags` ~7k | `grep -rl "@tag x"` ~200 | mokosh 35× worse |

**Structural difference:** `analyze` costs ~260 tokens of *output*; the parse/graph-build happens outside the token budget and is session-cached. Every later question is a bounded lookup. Without mokosh, every question re-pays the grep/read tax and fills context with file dumps.

The 26 structural questions in this audit cost **~24,000 tokens total via mokosh**. The same 26 via Read/Grep: conservatively **300,000–500,000+ tokens**, with ~5 not answerable that way at all (complexity, duplication, dead code, API surface, branch deltas).

**Where mokosh loses:** one-off single-file reads (adds an `analyze` round-trip for nothing); tasks that need code content to edit (mokosh points, you still Read); and its own token offenders — `list_tags` costs more than a targeted grep for one known tag. Break-even is roughly one structural question per session.

---

## Part 4 — Prioritized fix list

| # | Fix | Type | Effort | Payoff |
|---|---|---|---|---|
| 1 | `list_tags`: `minCount` default ≥ 2 + `kind` filter; drop declaration names by default | token | S | ~7k → ~1k per session; biggest single win |
| 2 | Exclude markdown nodes from `detectFeatures` / `buildFeatureGraph` / `collectUnassigned` (F2) | correctness | S | feature-graph ownership becomes correct |
| 3 | `get_affected` `testsOnly`: stop matching bare `tag.name === "test"` (F1) | correctness | S | tests-only blast radius no longer leaks logic files |
| 4 | `get_feature_graph`: summary-first (`hub` + counts), path lists behind `view:"full"` (T2/T3) | token | M | ~2.8k → ~500; matches its "cheap option" billing |
| 5 | `get_type_graph` inventory: truncate `doc` to first line, add `limit` (T4) | token | S | ~2.4k → ~800 |
| 6 | `get_workspace_affected`: throw the not-a-monorepo error like `get_workspace_packages` (F3) | correctness | S | no misleading empty success |
| 7 | `apply_tags`: counts-only default response, file list behind `verbose` (T2) | token | S | ~1.9k → ~150 |
| 8 | `get_module_responsibility`: bound the no-`paths` response (T2) | token | M | caps an unbounded path |
| 9 | `query` slim + `withMeta`: cap `exports` / `importsFiles` previews (T5) | token | S | trims hub-node responses |
| 10 | `get_api_surface`: partition non-source files out of `unreachableFromEntry` (minor) | quality | S | actionable list stays actionable |
| 11 | `analyze`: return `languageCoverage` only on first build (T6) | token | S | ~260 → ~120 on cache hits |
| 12 | Audit all other `tag.name === "test"` / bare-tag-name checks (F1 follow-up) | correctness | M | prevents the same class of bug elsewhere |
