# Issue 3 — JVM cycle detection is noise (whole packages flagged, "app depends on its own tests")

Status: proposed, not started. Found dogfooding v0.5.0 against Java/Kotlin monorepos
(2026-09-03).

## Symptom

On JVM repos, `analyze`'s `cycles` output (and `findCycles` everywhere) is dominated by
false positives:

- Every multi-file package is reported as a circular dependency.
- Production code is reported as depending on its own test code, and main↔test cycles appear.
- In monorepos, a module is reported as depending on another module that merely shares a
  package name.

## Root cause

All three trace back to the **synthetic same-package edge** (`jvmPackageEdge`,
`src/parser/lang/jvm-scan.ts:~95`) and how `JvmLangResolver` expands it.

### 3a — the synthetic edge makes every package a clique

Every JVM file gets an extra edge `import <own-package>.*` (type `side-effect`). The resolver
(`src/graph/lang-resolvers/jvm.ts:71-73`, `toResults`) expands `<pkg>.*` to **every other
file in the package, unconditionally** — not based on actual references. So for a package with
files `{A, B, C}`, the graph contains `A→B, A→C, B→A, B→C, C→A, C→B`: a complete digraph.

`GraphAnalyzer.findCycles` (`src/graph/analyzer.ts:59-96`) walks import edges with a
recursion-stack back-edge check and skips only `imp.isExternal` / empty `toPath`
(`analyzer.ts:73`). The synthetic edges are internal and resolved, so every package surfaces
as one big cycle.

### 3b — `src/main` and `src/test` merge because they share a package name

`buildPackageIndex` (`src/graph/lang-resolvers/jvm.ts:110-143`) groups files purely by their
`package` declaration. Java/Kotlin test files conventionally live in
`src/test/java/<same package>` — so `com.example.Foo` (main) and `com.example.FooTest` (test)
land in the **same bucket**. `Foo`'s synthetic `com.example.*` edge then resolves to
`FooTest`, and `FooTest`'s resolves back to `Foo`:

- production "depends on" its tests (wrong direction, pollutes `get_affected` /
  `get_dependents`);
- a main↔test 2-cycle for every tested class.

This happens even when `FooTest` is correctly classified `test` — `classifyJvm`
(`src/parser/lang/jvm-scan.ts:170`) does not influence resolution.

### 3c — cross-module package-name collision

Two Gradle/sbt modules both declaring `com.example.util` also merge in the index (same
grouping-by-package-name), so a file in module A gets synthetic edges to every
`com.example.util` file in module B.

### 3d — narrow test classification

`classifyJvm` only treats a file as `test` when its path matches
`/src/(test|androidTest|integrationTest|it)/` or it imports one of a fixed framework-prefix
list (`src/parser/lang/jvm-scan.ts:9-19`). Repos with non-standard test roots, or
TestNG/AssertJ/Truth/Hamcrest-only tests, get misclassified as `logic`, which then feeds
real-looking edges into the graph and worsens 3a/3b.

## Fix plan

### 3a — exclude synthetic same-package edges from structural analyses

- Add `isSamePackage?: boolean` to `ImportEdge` (`src/types/node.ts:15`).
- Set it in `jvmPackageEdge` (`src/parser/lang/jvm-scan.ts`) and carry it through
  `resolveImports` when spreading `...imp` (`src/graph/builder.ts:593`).
- In `GraphAnalyzer.findCycles`, skip `imp.isSamePackage` alongside the `isExternal` check
  (`src/graph/analyzer.ts:73`).
- Audit other structural consumers (`Graph.findCycles` callers, `analyzer.ts` export-usage,
  duplication) and decide per-call whether "referenced a sibling in the same package" counts.
  Keep the edges for `get_affected` / `get_dependents` / `get_workspace_affected` — blast
  radius across package siblings is real.
- Consider surfacing same-package coupling separately (a `packageCohesion` metric) rather
  than as import edges, if the clique is still useful signal.

### 3b + 3c — partition the JVM package index by module + source root

Rework `buildPackageIndex` / `PackageIndex` in `src/graph/lang-resolvers/jvm.ts`:

- Index shape becomes
  `Map<packageName, Array<{ module: string; sourceRoot: SourceRoot; files: string[] }>>`
  where `SourceRoot ∈ { main, test, androidTest, integrationTest, it, unknown }`, derived
  from the path segment before the package dirs (`.../src/<root>/<lang>/...`, plus Maven/
  Gradle conventional layouts), and `module` is the nearest enclosing Gradle/sbt module root
  (or the project root outside a monorepo).
- `resolve()` for the synthetic `<pkg>.*` edge returns only files in the **same module and
  same source root** as `currentFile`.
- `resolve()` for an **explicit** `import a.b.C` still crosses source roots and modules
  (real imports carry the full FQN and legitimately reference `src/main` from `src/test`, or
  another module). Only the synthetic wildcard is constrained.
- Additionally drop any `category === "test"` file as a target of a **non-test** file's
  synthetic edge (defence in depth for repos with unconventional layouts).

This is the same partitioned index [issues 1 & 2](01-monorepo-workspace-packages-timeout.md)
need to share across a workspace build — design it here, consume it there.

### 3d — broaden test classification

In `classifyJvm` (`src/parser/lang/jvm-scan.ts`):

- Add framework prefixes: `org.testng`, `org.assertj`, `com.google.truth`, `org.hamcrest`,
  `org.junit.jupiter` (already covered by `org.junit`), `io.mockk`, `com.nhaarman.mockitokotlin2`.
- Treat filename suffixes `*Test`, `*Tests`, `*Spec`, `*IT`, `*ITCase` as a weak `test`
  signal (only when not already classified by a stronger rule).
- Keep source-root match as the strongest signal (ties into 3b's `SourceRoot`).

## Expected outcome

- `analyze` `cycles` on a JVM repo drops to genuine import cycles only.
- `get_dependents` / `get_affected` no longer report production → test edges.
- Cross-module noise from shared package names disappears.

## Test plan

- Unit (`src/graph/analyzer` test): a 3-file package with only synthetic same-package edges
  produces **zero** cycles; a real `A→B→A` import cycle is still found.
- Unit (`src/parser/lang/java.test.ts` / `kotlin.test.ts`): `jvmPackageEdge` output carries
  `isSamePackage: true`; it survives `resolveImports`.
- Unit (`src/graph/lang-resolvers/jvm.test.ts`):
  - `com.example` main file's synthetic edge does **not** resolve to a `com.example` file
    under `src/test/`;
  - explicit `import com.example.Foo` from a `src/test/` file **does** resolve to the
    `src/main/` `Foo`;
  - synthetic edge in module A's `com.example.util` does not resolve into module B.
- Unit: `classifyJvm` — TestNG-only file, `FooIT.java` outside a test root, Kotest spec.
- Integration: fixture repo with `src/main` + `src/test` mirrored packages → `analyze`
  reports no main↔test cycles and no production→test dependents.
- Regression: existing `java.call-edges.test.ts` / `jvm.test.ts` still pass.

## Files touched

`src/types/node.ts`, `src/parser/lang/jvm-scan.ts`, `src/parser/lang/java.ts` (and the
hand-rolled `kotlin.ts` / `scala.ts` / `groovy.ts` if they emit the package edge),
`src/graph/builder.ts`, `src/graph/analyzer.ts`, `src/graph/lang-resolvers/jvm.ts`,
`docs/adr-017-jvm-languages.md` (amend) or new `docs/adr-018-jvm-monorepo-scale.md`.

## Dependencies

None blocking. Produces the partitioned package index that
[issues 1 & 2](01-monorepo-workspace-packages-timeout.md) build on — do this first.
