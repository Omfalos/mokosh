# ADR-006: Responsibility Graph — Semantic Role Assignment

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

The import graph tells you *what* a file imports and exports, but not *what it is for*. Questions like "what does this module do?", "which files are controllers vs. services?", or "give me a map of the whole codebase by role" require semantic labelling that is not derivable from import edges alone.

The goal was a compact, per-file answer to "what is this module responsible for?" that an AI assistant can receive for many files at once without needing to read their source.

---

## Decision

Build a `ResponsibilityGraph` — a map from every file path to a `ModuleResponsibility` record — derived entirely from data already present in the `FileNode`. No new parsing or inference is performed.

---

## Design

### `ModuleResponsibility` fields

Each record contains:
- `path` — project-relative file path.
- `role` — a `ModuleRole` string inferred from the file's path and graph category (see below).
- `description` — the file's leading JSDoc comment, if one was captured during parsing. `undefined` when absent.
- `exports` — flat list of exported symbol names.
- `featureHub` — the feature domain this file belongs to, if any. Derived by running `buildFeatureGraph` with default options.

### Role inference (`inferRole`)

Role is determined by two signals, checked in order:

1. **Graph category** (from the import graph): `test` → `"test"`, `config` → `"config"`, `type-only` → `"types"`. These take precedence over path-based rules.

2. **Path conventions**: path segments are matched most-specific to least-specific against a fixed vocabulary of common directory names. Examples: a segment `controllers/` → `"controller"`, `middleware/` → `"middleware"`, `utils/` → `"util"`. The full vocabulary is defined in the role inference module.

Segment matching is discrete (checks `/<segment>/` or `/<segment>.`) to avoid false positives from names that contain a segment as a substring. Files that match nothing fall back to `"other"`.

### `featureHub` resolution

`buildFeatureGraph` is called once with default options. Each file's path is looked up in the resulting assignment map. Hub files are considered members of their own feature.

### Output type

```
ResponsibilityGraph = Map<filePath, ModuleResponsibility>
```

Test files are included with `role: "test"` — callers can filter them if not needed.

**MCP tool**: `get_module_responsibility` returns the full `ResponsibilityGraph`, letting AI assistants scan the role of every file in a single call.

---

## Options considered

### A. Infer role from imports and exports (graph-structural)

Classify files based on what they import and what imports them — e.g. a file imported by many and importing few is a utility; a file at the bottom of a long chain is a leaf.

**Rejected**: structurally similar files can have very different roles (a `service` and a `model` may have identical import depth). Path-naming conventions are a stronger, more direct signal and are already used universally across frameworks.

### B. Require developer-supplied role annotations

Let developers tag files explicitly via config or comment markers.

**Rejected**: adds a maintenance surface. The path-convention approach gives useful results with zero annotation overhead, and the `description` field (from existing JSDoc) already captures developer intent when present.

### C. Store role on `FileNode`

Add a `role` field to `FileNode` so it is always available alongside the other graph data.

**Rejected**: role is a derived, optional label — not a core graph property. Storing it on `FileNode` would inflate the serialised graph for all consumers. Computing it on demand from existing `FileNode` data is cheap.

---

## Consequences

**Positive**
- Token-efficient: one `get_module_responsibility` call gives an AI assistant a structured overview of the entire codebase without reading any source files.
- No new parsing: `description` comes from JSDoc already captured, `exports` from the export list, `role` from path and category, `featureHub` from the feature graph (itself derived from import counts).
- Role vocabulary is intentionally generic — it applies to backend, frontend, CLI, and library projects alike.

**Negative**
- Path-convention matching is heuristic: a project that does not follow common directory naming (e.g. puts controllers in `src/actions/`) will produce mostly `"other"` roles.
- `description` is absent for most files unless developers write file-level JSDoc — this is uncommon in many codebases.
- `featureHub` depends on hub detection, which has its own limitations (see ADR-005). Files below the out-degree threshold will have no `featureHub` even if they conceptually belong to a feature.
- Role vocabulary is a closed enum. New roles (e.g. `"saga"`, `"selector"`, `"hook"`) require a code change to the inference module.