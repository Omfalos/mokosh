# Analysis: what mokosh is, how well it works, and what it's actually worth

Status: point-in-time assessment, not a plan of work (companion to `mcp-tool-improvements.md`
and `performance-improvements.md` in this directory). Based on `README.md`, `docs/architecture.md`,
`docs/mcp.md`, `CHANGELOG.md`, and direct inspection of `src/` on 2026-08-12, version 0.4.0.

## What it is, in one paragraph

Mokosh parses source files across 12 languages into per-file ASTs, extracts imports/exports/tags/
complexity/call-edges from each, and assembles the result into a single traversable dependency
graph (`Map<relPath, FileNode>`). It exposes that graph three ways: a CLI (JSON/Mermaid output),
a library API, and an MCP server with 25 tools. The distinguishing idea isn't "build a dependency
graph" — several tools do that — it's **build one graph that's simultaneously precise enough for
correctness tooling (cycle detection, blast-radius analysis) and compact enough to hand an LLM as
context**, and do both across a genuinely heterogeneous polyglot codebase rather than just a
single-language monorepo.

## How the graph actually works

```
Entry points → GraphBuilder (queue-pumped wavefront, not DFS)
  each round: parseFile() [per-language AST parser] → resolveImports() [specifier → path]
  → reuse node if mtime+size unchanged (incremental)
→ separate scans pick up test files and .md/.mdx docs (never reachable via import edges)
→ 6 enrichment passes: coverage, export-usage-ratio, library tags, testedBy, test-node tags, doc-drift
→ Graph: Map<relPath, FileNode>, each node carries imports[], exports[], tags[], category,
  optional commitCount90d/coveragePct/complexity/cognitiveComplexity/callEdges
```

Three properties of this design matter more than they first appear:

1. **The graph is a first-class value, not a query-time artifact.** `serialize()`/`deserialize()`
   round-trip to JSON, so it can be cached to disk (CLI) or held in an MCP session (server) and
   reused across many queries without re-parsing. Most of the 25 MCP tools are thin views over
   one built graph, not independent scans.
2. **Incremental rebuild is mtime+size, not a content hash.** Cheap and correct for the common
   case (a file that hasn't been touched) but means a file with the same size and mtime as before
   (rare, but possible after certain checkout/rebase operations) would be wrongly treated as
   unchanged. Worth knowing as a sharp edge, not necessarily worth fixing.
3. **Two independent traversal graphs live on the same nodes**: import edges (`imports[]`,
   structural — "what does this file bring in") and call edges (`callEdges`, behavioral — "what
   function actually invokes what"). Most tools (`get_dependents`, `get_affected`) use the
   former; `get_callers`/`get_call_graph`/`find_symbol` use the latter, which is strictly more
   precise but only populated for TS/JS, Go, and Python (per ADR-011). This is a real and
   correctly-documented precision gradient, not a hidden gap — `find_symbol`'s tool description
   and `analyze`'s `languageCoverage` field both surface it to callers.

## What value it actually provides

**For humans:** cycle detection as a CI gate, unused-file detection, duplicate-code detection
(suffix-array based, cross-language, structural for CSS), doc-drift detection (docs referencing
files that changed more recently than the doc), complexity hotspot scanning, test-tag proposal
from `git diff`. These are the kind of checks that normally require assembling five different
single-purpose tools (madge/depcheck for JS-only unused/cycles, jscpd for duplication, a custom
script for doc-drift) — mokosh's differentiator is doing all of it from one graph, across
languages a JS-only tool wouldn't touch (Python, Go, Lua, Gherkin).

**For AI assistants (the stated primary audience):** this is where the design choices concentrate.
`query`'s `slim: true` default, `get_feature_graph`'s claimed 85-95% token reduction over a raw
graph query, `find_symbol`'s precision-graded results, and `get_module_responsibility`'s
JSDoc-aware summaries are all specifically shaped for context-window economics, not just
correctness. The MCP session cache (`SessionState`) exists so a multi-turn agent conversation
pays the parse cost once. This is a coherent bet: the tool is optimized for "an agent will ask
many small questions about this codebase across a session," not "run once, get a report."

**Runs entirely local, no telemetry, no network** — genuinely differentiating for anyone wary of
sending source code to a hosted code-intelligence service; this is a real, not just marketed,
property (confirmed: MCP server is stdio-only, no fetch/network calls found in the graph-building
path).

## How well is it actually built

**Strengths, evidenced not just claimed:**
- Real perf engineering under the hood: worker-pool offloading with a measured spin-up-cost
  tradeoff (not blindly "always parallelize"), batched git log instead of N subprocess spawns,
  suffix-array duplicate detection instead of the naive pairwise approach a first cut would use
  (ADR-015 documents an explicit algorithmic upgrade from an earlier heuristic version), per-session
  token caching keyed by mtime/size.
- ADRs for every non-obvious decision (15 of them) — architecture decisions are recorded with
  rationale, not just implemented silently. This is unusually disciplined for a project this size.
- Test coverage breadth: 70 test files including targeted algorithm tests
  (`suffix-array.test.ts`, `lcp-intervals.test.ts`, `shingle.test.ts`) separate from integration
  tests — the duplication engine in particular is tested at the algorithm-unit level, not just
  end-to-end.
- Honest precision documentation: `find_symbol` and `get_call_graph` explicitly tell callers when
  a language's parser can't back up a claim (Lua/CoffeeScript/Gherkin exports aren't populated,
  so a lookup silently returns empty rather than a wrong answer) instead of overclaiming uniform
  behavior across 12 languages.

**Known weaknesses (from project memory, not speculation):**
- Worker-pool default threshold is confirmed wrong for the common case (regresses <600-700 files)
  and hasn't been corrected — see `performance-improvements.md` §1.
- Had a real command-injection vulnerability in `git.ts` (execSync + interpolated filenames),
  since fixed with `execFileSync` + arg arrays — evidence the security bar is taken seriously
  after being caught, but also evidence this class of bug existed once and is worth re-auditing
  for elsewhere (any other subprocess spawn in the codebase).
- MCP server exposes only `capabilities: { tools: {} }` — no resources, prompts, or progress
  notifications, despite already having the internal state (FS watcher, dirty-tracking) that
  would support "is my graph stale" as a first-class signal instead of a guess. See
  `mcp-tool-improvements.md`.
- 25 MCP tools is a lot of surface area for a caller (human or LLM) to hold a mental model of;
  `docs/mcp.md` mitigates this with a clear call-order note ("`analyze` first...") but the tool
  count itself is a complexity cost, not just a capability count.

## Bottom line

Mokosh is a well-engineered, honestly-documented tool solving a real problem (cross-language
dependency intelligence sized for LLM context budgets) that most competing tools don't solve at
all, because they're either JS-only or built for humans reading a diagram rather than an agent
asking targeted questions across a session. The core graph-building pipeline is sound and the
team clearly profiles and fixes real bottlenecks rather than guessing. The gaps that exist
(worker-pool threshold, MCP capability surface, resolver caching unconfirmed) are specific,
already-scoped, and tracked in the two companion plans in this directory — not signs of an
unfinished or fragile foundation.