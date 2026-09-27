# Issue 13 — `get_call_graph`'s `definedIn` silently picks one definition when a function/method name isn't unique

Status: **open**. Found dogfooding v0.5.4 against gin-gonic/gin (call-graph tool audit).

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

## Proposed fix (not built)

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
