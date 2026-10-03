# Issue 21 — `CallEdge.toFile` silently picks one arbitrary candidate when a call target's name isn't unique

Status: **open, not started**. Found dogfooding v0.5.5 against gin-gonic/gin, immediately after
[issue 13](13-call-graph-definition-ambiguity.md)'s fix shipped (PR #28), 2026-10-03.

## Symptom

`binding/binding.go` (`//go:build !nomsgpack`) and `binding/binding_nomsgpack.go`
(`//go:build nomsgpack`) both export a function named `Default` — mutually exclusive at Go compile
time via build tags, confirmed on disk at lines 95 and 91 respectively. Querying the *same* call
edge through two different tools gives two different answers:

- `query`'s `callEdges` on `context.go` reports `{"from":"Context.Bind","to":"Default",
  "toFile":"binding/binding_nomsgpack.go"}`.
- `get_call_graph(function:"Default")` reports `"definedIn":"binding/binding.go"` for the same
  caller (`Context.Bind`/`Context.ShouldBind`).

The second of these is **not** a bug — per issue 13's shipped fix, a real ambiguous name now makes
`get_call_graph` report `definedInCandidateCount: 2` and both candidates via
`includeCandidates: true`, rather than silently picking one. The first bullet is the actual,
still-open problem: `query`'s raw `callEdges` field silently commits to one arbitrary file with no
ambiguity signal, for the exact same underlying collision issue 13 already identified and fixed —
just reached through a different field.

## Root cause

Issue 13's fix lives entirely in `queryCallGraph` (`src/graph/call-graph/index.ts`), which
computes `definedIn`/`candidates` fresh from `graph.nodes`'s `exports` at query time. It does not
touch where a `CallEdge`'s `toFile` is actually decided, which happens earlier and separately, at
**build time**, in `src/graph/builder.ts:638`:

```ts
resolved.push({ from: pending.from, to: pending.to, toFile: matches[0]!.path });
```

When a deferred call-target marker resolves against more than one matching file (`matches.length
> 1`), this line unconditionally takes `matches[0]` — array order, not any meaningful
tie-break — and bakes that single choice permanently into the `CallEdge` stored on the `FileNode`.
Every tool that reads `FileNode.callEdges` directly (`query`'s `callEdges` field, `find_symbol`'s
caller list wherever it uses raw edges rather than `queryCallGraph`) inherits this silent,
arbitrary commitment with no way to know it was ambiguous. `queryCallGraph`'s fix is correct and
complete for what it scoped (a fresh name→definition lookup) but doesn't retroactively fix data
that was already baked into `CallEdge.toFile` one layer below it.

Compare to issue 12's same-package call resolution (`GraphBuilder.resolveJvmSamePackageCallEdges`),
which already does the right thing for its own ambiguity case: "exactly one match becomes a
`CallEdge`, ambiguous (two+ matches) drops silently" — i.e. issue 12's resolver refuses to guess.
The `matches[0]` line at `builder.ts:638` is a different resolution path (general call-target
resolution, not specifically same-package) that never got the same treatment.

## Fix (not started)

Apply the same "don't guess" discipline issue 12 already established, at this resolution site:
when `matches.length > 1`, either

1. **Drop the edge** (simplest, consistent with issue 12's precedent) — a caller who wants to see
   it can still find it via `get_call_graph`'s `candidates`, which already handles the ambiguous
   case honestly; or
2. **Keep the edge but mark it ambiguous** — e.g. a `toFileCandidates: string[]` field alongside
   (or instead of) `toFile` when there's more than one match, so `query`'s `callEdges` can at
   least be filtered or flagged by a caller who cares, rather than silently misrepresenting the
   data as unambiguous.

Either way, `query`'s MCP tool description and `docs/mcp.md`'s `callEdges` field description
should say explicitly that an edge was resolved unambiguously (or how it was marked when it
wasn't), once shipped.

## Test plan (for whoever picks this up)

- `src/graph/builder.test.ts` (or wherever call-edge resolution is unit-tested): a fixture with
  two files exporting the same call-target name, both reachable from a caller — assert the
  ambiguous edge is dropped (fix 1) or carries the chosen marker (fix 2), not an arbitrary
  `matches[0]` pick.
- A fixture with a genuinely unique target name — assert unchanged behavior (no regression).
- Regression: issue 12's own same-package-ambiguity test (`matches` with 2+ entries → dropped)
  stays passing, since this issue's fix should make the *general* resolution path consistent with
  what that path already does for the JVM same-package special case.

## Cross-issue dependencies

- Direct follow-on to [issue 13](13-call-graph-definition-ambiguity.md) — same underlying
  "name isn't unique in scope" class of problem, different code path (`queryCallGraph`'s
  query-time lookup vs. `builder.ts`'s build-time edge resolution), so issue 13's fix doesn't
  cover this one.
- Shares its target discipline with [issue 12](12-call-edge-same-package-resolution.md)'s
  "ambiguous → drop silently rather than guess" precedent at a different resolution site.
