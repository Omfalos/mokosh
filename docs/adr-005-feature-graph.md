# ADR-005: Feature Graph — Domain Clustering by Hub Detection

**Date:** 2026-06-15
**Status:** Accepted

---

## Context

The import graph is a flat map of files and edges. For a large project it gives no sense of which files belong together as a coherent feature or subsystem. Questions like "what files are part of the parser feature?" or "what is the scope of the MCP server domain?" require either manual annotation or a way to derive groupings automatically.

The goal was a zero-configuration clustering that works across any project layout without requiring explicit feature declarations.

---

## Decision

Detect *feature hubs* — files with a high number of internal imports (high out-degree) — and group each hub with all files it transitively reaches. The result is a `FeatureGraph`: a map of feature names to `FeatureDomain` records, plus an `unassigned` list for files not reachable from any hub.

---

## Design

### Hub detection (`detectFeatures`)

A file is a feature hub when:
- It is not a test file (`category !== "test"`).
- It is not a barrel re-export (`category !== "barrel"`).
- Its count of non-external internal imports meets or exceeds `minOutDegree` (default: 5).

The auto-generated feature name is the file's basename (or its parent directory name for `index.*` files), prefixed with `feature:`. Example: `src/parser/index.ts` → `feature:parser`.

### Graph build (`buildFeatureGraph`)

Three phases:

1. **Collect reachability**: for each hub, run a DFS over outgoing import edges and collect all transitively reachable files (the hub itself is excluded from its own file set).

2. **Assign files to hubs**: each non-hub file is assigned to the hub with the lowest out-degree that can reach it. Lower out-degree means a more specific hub — a file reachable by both a 6-import hub and a 20-import hub is assigned to the 6-import hub. The comparator is overridable via `options.hubComparator`.

3. **Collect unassigned**: files that are neither a hub nor reachable from any hub (e.g. shared low-degree utilities, top-level entry points) are placed in `unassigned`.

### Data structures

```
FeatureGraph
  features: Map<featureName, FeatureDomain>
  unassigned: string[]

FeatureDomain
  hub: string          // project-relative path of the hub file
  outDegree: number    // number of internal imports the hub has
  files: string[]      // all files transitively reachable from the hub
```

### MCP tool

`detect_features` returns the `FeatureGraph`. Callers can ask "what files are in the parser domain?" or "which files are unassigned?" without traversing the full graph.

---

## Options considered

### A. Require explicit feature declarations

Let developers annotate hubs with a config file or comment marker (e.g. `// @feature: parser`).

**Rejected**: adds friction and maintenance burden. Out-degree heuristics work surprisingly well because files that import many other files are almost always real orchestrators, not coincidentally high-degree.

### B. Assign files to all reachable hubs

Let a file belong to multiple feature domains if multiple hubs can reach it.

**Rejected**: overlapping membership makes the output harder to consume. A flat assignment (one hub per file) gives cleaner "what does feature X own?" answers. Shared utilities end up `unassigned`, which is the correct signal.

### C. Use in-degree (fan-in) instead of out-degree (fan-out)

Detect hub candidates by how many other files import them, rather than by how many they import.

**Rejected**: high in-degree identifies shared utilities (imported by many), not feature orchestrators (which import many). Feature hubs are orchestrators that pull in their dependencies, so out-degree is the right signal.

---

## Consequences

**Positive**
- Zero configuration — hub detection is automatic for any project that follows normal import patterns.
- `unassigned` is a useful signal: shared utilities and thin entry points are naturally excluded from all domains.
- `minOutDegree` is the single tuning knob; callers can raise it for large monorepos or lower it for smaller projects.
- The hub comparator is injectable, enabling custom clustering strategies without changing the core algorithm.

**Negative**
- Heuristic-based: a high-degree file that is *not* a feature orchestrator (e.g. a god-object utility) will be incorrectly promoted to a hub. The `minOutDegree` threshold mitigates this but does not eliminate it.
- Feature names are derived from filenames, which may collide when two files share the same basename in different directories.
- A file reachable by multiple hubs is assigned to the most specific (lowest out-degree) one, which may not match developer intent in all cases.
- `unassigned` contains both genuinely shared utilities and files that simply fall below the out-degree threshold — consumers cannot distinguish these two cases without additional inspection.