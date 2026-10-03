# Issue 13 — `get_call_graph`'s `definedIn` silently picks one definition when a function/method name isn't unique

Status: **shipped** (2026-10-01). Found dogfooding v0.5.4 against gin-gonic/gin (call-graph tool
audit). See "Decided approach" below for the agreed design, implemented as described.

**Fix shipped:** `queryCallGraph` (`src/graph/call-graph/index.ts`) now collects every node whose
`exports` matches `functionName` into a `candidates` array (mirroring `findSymbol`'s,
`src/graph/symbol.ts`, "collect every match" pattern) instead of overwriting a single variable.
`FunctionCallInfo` (`src/graph/call-graph/types.ts`) gained an always-present
`definedInCandidateCount: number` field — `1` in the normal, unambiguous case, where `definedIn`
and `callees` behave exactly as before (zero regression). When it's `>1` and no `file` arg
narrowed the search, `definedIn` is `null` and `callees` is empty rather than guessed; `callers`
is still returned either way, since it's just every call edge in the graph whose `to` matches
`functionName`, independent of which file "really" defines it. A new `file` arg (MCP
`get_call_graph` / `queryCallGraph`'s `options.file`) disambiguates by narrowing the search to one
specific path, bypassing the ambiguity entirely; `includeCandidates: true` opts into the full
`candidates: string[]` list. The `receiverType` disambiguator and the shared
`findExportingNodes()` helper with issue 12 remain deferred, per the decided approach below.
Covered by `src/graph/call-graph/index.test.ts` (including a 25-candidate fixture mirroring
mokosh's own `run` collision across `src/cli/commands/*.ts` + `src/cli/runner.ts`) and
`src/mcp/handlers.test.ts`. See [ADR-003](../adr-003-call-edge-graph.md)'s Query API section and
[docs/mcp.md](../mcp.md)'s `get_call_graph` entry for the shipped contract.

## Symptom

`get_call_graph(function: "Bind")` on gin returns a single `definedIn: "binding/yaml.go"`, with
empty `callers`/`callees` — but `Bind` is a method name shared by at least 11 distinct receiver
types across the `binding/` package (`bson.go`, `form.go`, `header.go`, `json.go`, `msgpack.go`,
`plain.go`, `protobuf.go`, `query.go`, `toml.go`, `xml.go`, `yaml.go` each export their own
`Bind`). The tool gives no indication that 10 other definitions exist, that the one it picked is
arbitrary, or that the query is under-specified — it looks exactly like a normal, unambiguous,
successful lookup.

## Root cause

`queryCallGraph` (`src/graph/call-graph/index.ts`):

```ts
for (const node of graph.nodes.values()) {
  if (node.exports.some((exportedSym) => exportedSym.name === functionName)) {
    definedIn = node.path;
  }
  ...
}
```

This loop has no uniqueness check — `definedIn` is simply overwritten on every match found while
iterating `graph.nodes.values()` (Map iteration order = insertion order = whatever order the
graph builder's wavefront visited files in, which is not stable/meaningful to a caller). The last
match wins, silently. There is no `ambiguous` flag, no count of matches, no list of the other
candidate files.

This is a distinct problem from issue 12 (same-package call resolution): issue 12 is about
**call edges never being created**; this is about **the definition lookup itself** being
underspecified once a name isn't unique — even a function with perfect call-edge extraction would
still hit this if its name collides with another file's export.

## Why this matters beyond the contrived-sounding "same method name" case

Name collisions like this are the norm, not the exception, for:
- Interface implementations (`Bind`, `String`, `Error`, `Close`, `Validate`, …) — one name,
  many receiver types, by design.
- Common utility/helper names (`parse`, `validate`, `run`, `New`) repeated across unrelated
  packages in a large codebase.

Any of these makes `get_call_graph`/`find_symbol`'s `callers` lookup return a plausible-looking
but wrong or incomplete answer with no warning — worse than an explicit error, since a caller has
no signal to double-check.

## Decided approach (2026-10-01)

A `Plan`-agent pass confirmed the concrete reproduction case live on mokosh's own codebase before
this was finalized: 25 files export a top-level `run` function (24 CLI commands +
`src/cli/runner.ts`'s dispatcher), and `get_call_graph(function: "run")` today silently returns
`definedIn: "src/cli/runner.ts"` with no signal the other 24 exist. Notably, `find_symbol`
(`src/graph/symbol.ts`) already does this correctly — it collects every matching node into an
array rather than overwriting a single variable — so the fix is substantially "bring
`queryCallGraph` in line with its own sibling," not a novel design.

**Decisions:**

1. **Response shape: additive field, not a default-breaking change.** `definedIn` keeps behaving
   exactly as today when there's exactly one match — zero regression for the common case. Add a
   new always-present field (e.g. `definedInCandidateCount: number`, `1` in the normal case) as
   the cheap, always-on signal that something might be wrong; gate the full `candidates: string[]`
   list behind an opt-in arg, consistent with this repo's summary-first MCP convention
   (`get_api_surface`'s `view`, `query`'s `slim`). Rejected: changing `definedIn`'s default meaning
   outright — `FunctionCallInfo` is a public exported type, so that would be a breaking change to
   a documented contract for comparatively little gain over an additive field.
2. **`callers`/`callees` in the ambiguous case: return `callers`, empty `callees`.** `callers` is
   honest regardless of which file is the "real" definition (it's edges *into* this name, not
   edges that assume one specific file). `callees` requires committing to one specific file's call
   edges — computing it would silently reintroduce the exact guessing problem this issue exists to
   fix, so leave it empty until disambiguated.
3. **Ship the `file` disambiguator in the same change**, not a separate follow-up. A
   `candidates: [...]` list with no way to get a precise answer afterward makes the fix only
   half-useful; narrowing by `file` is small (it only needs `node.path`, already-available data)
   riding along with the response-shape work already happening in this same area.
4. **`receiverType` disambiguator: explicitly out of scope.** It needs a new schema field
   (`FileNode.exports[].receiverType` or equivalent) that doesn't exist anywhere in the graph model
   today — confirm during implementation that nothing downstream actually needs it yet before
   deferring it further.
5. **Relationship to issue 12: confirmed genuinely separate** (12 = call edges never created; 13 =
   definition lookup picking one of several real exports with no signal). The optional shared
   `findExportingNodes()` helper both issues could theoretically use is intentionally **not**
   built now — issue 12 isn't landing in the same change, and designing a shared primitive before
   a second real caller exists risks guessing its shape wrong.
6. **New field, not the existing `caveats` convention.** `caveats` in this codebase means "this
   result is real but lossy due to language fidelity" — a different kind of warning. Ambiguity is
   a structural property of this specific query's result (how many real definitions exist), so it
   gets its own field (`definedInCandidateCount`, per decision 1) rather than being folded into a
   string-message convention meant for something else.

## Proposed fix (superseded by "Decided approach" above; kept for the original reasoning)

1. Minimal (cheap, high value): when more than one node's `exports` matches `functionName`,
   return `definedIn: null` (or a new explicit field, e.g. `ambiguous: true`) plus a
   `candidates: string[]` list of every matching file, instead of picking one. Callers/callees
   for an ambiguous name genuinely can't be computed by a name-only lookup, so this is honest
   about the tool's real precision rather than silently degrading it.
2. Better (bigger, optional follow-up): accept an optional disambiguator in the MCP/CLI args —
   e.g. `file` (narrow to a specific defining file) or `receiverType` for Go/method-style
   languages — so a caller who already knows which `Bind` they mean can still get a precise
   answer instead of only the ambiguity report.
3. Either way, update `get_call_graph`'s MCP tool description (`src/mcp/tools.ts`) and
   `queryCallGraph`'s JSDoc to state the disambiguation behavior explicitly once shipped.

## Test plan (for whoever picks this up)

- `src/graph/call-graph/index.test.ts` (or wherever `queryCallGraph` is unit-tested): a fixture
  graph with two nodes exporting the same function name — assert the minimal fix's
  `ambiguous`/`candidates` shape instead of an arbitrary single `definedIn`.
- A fixture with a genuinely unique name — assert unchanged, unambiguous behavior (no
  regression for the common case).
- If the disambiguator option (fix 2) ships: a test that passing `file` narrows correctly among
  colliding names.
- `src/mcp/handlers.test.ts`: `get_call_graph`/`find_symbol` handler tests covering the new
  response shape.

## Cross-issue dependencies

- Shares its "don't guess on ambiguity" concern with issue 12 — both need a uniqueness/ambiguity
  check over a symbol-name search, one over call *targets* (issue 12), one over call
  *definitions* (this issue). A combined design pass could share the underlying "is this name
  unique in scope" helper.
