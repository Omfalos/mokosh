# ADR-020: Whole-workspace analysis via `WorkspaceGraph.flatten()`

**Date:** 2026-09-07
**Status:** Accepted

---

## Context

On a monorepo root, `analyze` builds a fully-parsed and fully-enriched `Graph` per package
(`createWorkspaceGraph`), tags cross-package import edges (`isWorkspace` / `workspacePackage`),
and persists the whole `WorkspaceGraph` to disk. All node keys are monorepo-root-relative, so the
per-package graphs already share one namespace.

Consumers, however, forced per-package invocations:

- **CLI**: `resolveMonorepoPackageGraph` hard-errored on every whole-graph command (`--query`,
  `--find-complex-functions`, `--type-graph`, …) unless `--package`/`--file` was passed. No
  fan-out path existed at all.
- **MCP `query`**: fanned out per package, but `sort`/`limit` applied *per package* before
  concatenation (no global ranking), and `filterGraph` trimmed import edges to same-package
  targets, so cross-package edges vanished from results. No `package:` filter key.
- **MCP `get_affected` / `get_dependents` / `get_callers`**: resolved only the owning package's
  isolated graph, so incoming cross-package blast radius was invisible — users had to know to
  call `get_workspace_affected` instead (which was itself only one hop cross-package).
- **MCP `get_type_graph` / `get_feature_graph` / `get_call_graph`**: required a `package` arg.

The data to answer whole-workspace questions was already in memory; only the read path was
missing.

---

## Decision

### `WorkspaceGraph.flatten()` — one merged read-only `Graph`

`flatten()` merges every package's **own** nodes (those under the package's `relativeRoot` —
predicate `packageOwnsFile`, shared with `restrictToOwnFiles`) into a single
`Map<path, FileNode>`, paired with a `packageOf` path→package-name lookup. `FileNode`s are shared
by reference, never cloned — the merged graph is read-only, same as the existing
`restrictToOwnFiles` pattern. The result is memoized on the `WorkspaceGraph` instance; a rebuild
replaces the whole instance, so no invalidation is needed.

"Borrowed" nodes (each package graph also carries a node for every cross-package file it imports,
so outward traversal reaches them) are dropped during the merge — the owning package contributes
its own, fully-enriched copy instead, so nothing is double-counted.

Because cross-package edges already hold real root-relative `toPath`s, `Graph.traverse` and
`Graph.findCycles` span package boundaries on the flattened graph with **no special-casing**.
`getAffectedAcrossPackages` is now a thin wrapper over `flatten()` + one incoming traversal —
fully transitive, replacing the old two-step (intra-package traverse + coarse cross-package edge
scan).

### What runs on the flattened graph

- **CLI**: on a monorepo root with no `--package`, every command runs against `flatten()`. The
  flat `Graph` and `packageOf` flow through `CommandContext`.
- **MCP**: `query`, `get_affected`, `get_dependents`, `get_callers`, `get_dependencies`,
  `get_type_graph`, `get_feature_graph`, `get_call_graph` — via `SessionState.resolveFlatGraph` /
  `resolveFlatGraphForFile`. `sort`/`limit` now rank globally; each result node carries its
  `package`. A `package` arg (or `package:<name>` in a `query` filter — new `NodeQuery.package`
  field, threaded to `matchNode` as `packageOf` alongside the existing `reverseIndex`) narrows to
  one.

### What stays per-package

- `find_unused` — entry-point reachability is inherently per-package; a whole-repo graph would
  flag every other package's files as unused.
- `apply_tags` / `propose_tags` / `propose_affected_tests` — they write per-package tag files, and
  a changeset commonly spans packages.
- The remaining fan-out analysis tools (`find_duplicates`, `find_complex_functions`,
  `find_risk_hotspots`, `list_tags`, `find_uncovered`, `check_doc_drift`, `find_symbol`,
  `get_module_responsibility`, `detect_features`) already fan out and apply a global `sort`/`limit`
  after merging, tagging each item with its `package` — left as-is.
- `get_api_surface` runs one report per package, but its entry points come from each package's own
  manifest/detector (via `WorkspacePackage.entryPoints`), not from re-reading the monorepo-root
  `package.json`; a package with no entry point is `skipped` rather than failing the call, and the
  per-package output is capped. Its non-workspace entry-point detection is also language-aware now
  (Go / Python / JVM projects with no `package.json`). Not related to `flatten()`, but part of the
  same "every tool works on a monorepo" pass.

---

## Consequences

- Supersedes the earlier "concatenation only, never a merged `Graph`" stance in
  `src/mcp/handlers.ts`. The objection it guarded against — double-counting borrowed nodes — is
  handled by the `packageOwnsFile` filter in `flatten()`.
- `FileNode` gains an optional `package?: string` — a query/output-time annotation only, never set
  by the builder or persisted.
- Whole-workspace traversals visit more nodes than a single package graph; acceptable for a
  read-only, not-hot-path operation, and the merge is a map union over already-built nodes.
- `get_workspace_affected` is retained for compatibility but `get_affected` now covers the same
  cross-package ground with full transitivity.
