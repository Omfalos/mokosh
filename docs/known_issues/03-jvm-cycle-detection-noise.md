# Issue 3 — JVM monorepo cycle noise: test files inflate the package index into false cross-package cycles

Status: fixed (2026-09-03). Found dogfooding v0.5.0 against Java/Kotlin monorepos.
The `JvmLangResolver` package index is now partitioned into `(module, source-root)` slices
(`jvmPathPartition` in `src/graph/lang-resolvers/jvm.ts`): the synthetic same-package
wildcard resolves only within the importer's own module and source set, while explicit FQN
imports still cross both boundaries. The synthetic edge carries `isSamePackage: true`
(`src/types/node.ts`, set in `jvmPackageEdge`) and `GraphAnalyzer.findCycles` skips it, so the
latent intra-package clique (3a) no longer surfaces as cycles while blast-radius analyses keep
the edge. `classifyJvm` gained TestNG/AssertJ/Truth/Hamcrest/MockK import prefixes and a weak
`*Test` / `*Spec` / `*IT` filename fallback (3d). Regression tests in
`src/graph/lang-resolvers/jvm.test.ts`, `src/graph/analyzer.test.ts`, and
`src/parser/lang/java.test.ts`.

## Symptom

Scale-dependent. A **single-module** JVM project is largely fine — dogfooded against a
33-dependency Android app, `analyze`'s `cycles` output was clean and usable.

On a **monorepo**, `cycles` (and `findCycles` everywhere) fills with false positives, and
the damaging ones cross package/module boundaries:

- `app ↔ app`, `app → lib → app`, and similar loops where the edge that *closes* the loop is
  a **test file**, not a real dependency — `com.example.app.Foo` (main) "depends on"
  `com.example.app.FooTest` (test) and vice versa.
- A module is reported as depending on another module that merely shares a package name.
- Production code shows up as depending on its own test code in `get_affected` /
  `get_dependents`.

The common thread: test sources are indexed as ordinary members of the main package, so the
synthetic same-package edge wires main↔test and module↔module links that don't exist.

## Root cause

Everything below traces to the **synthetic same-package edge** (`jvmPackageEdge`,
`src/parser/lang/jvm-scan.ts:99`) plus a `JvmLangResolver` package index
(`src/graph/lang-resolvers/jvm.ts:110-143`) that is keyed by package name alone — no module
boundary, no `src/main` vs `src/test` split. 3b and 3c are what actually surfaced in
dogfooding; 3a is a latent contributor that stays invisible until a boundary is crossed.

### 3b — `src/main` and `src/test` merge because they share a package name

`buildPackageIndex` groups files purely by their `package` declaration. Java/Kotlin test
files conventionally live in `src/test/java/<same package>` — so `com.example.Foo` (main)
and `com.example.FooTest` (test) land in the **same bucket**. `Foo`'s synthetic
`com.example.*` edge then resolves to `FooTest`, and `FooTest`'s resolves back to `Foo`:

- production "depends on" its tests (wrong direction, pollutes `get_affected` /
  `get_dependents`);
- a main↔test 2-cycle for every tested class, and longer `app → lib → app` loops once a test
  file pulls in another module.

This happens even when `FooTest` is correctly classified `test` — `classifyJvm`
(`src/parser/lang/jvm-scan.ts:180`) does not influence resolution.

### 3c — cross-module package-name collision

Two Gradle/sbt modules both declaring `com.example.util` also merge in the index (same
grouping-by-package-name), so a file in module A gets synthetic edges to every
`com.example.util` file in module B. In a monorepo this is common — shared `util`, `model`,
`di` package names across modules — and it manifests as module-level cycles.

### 3a — the synthetic edge makes every package a clique (latent)

Every JVM file gets an extra edge `import <own-package>.*` (type `side-effect`). The resolver
(`src/graph/lang-resolvers/jvm.ts:71-73`, `toResults`) expands `<pkg>.*` to **every other
file in the package, unconditionally** — not based on actual references. So for a package with
files `{A, B, C}`, the graph contains `A→B, A→C, B→A, B→C, C→A, C→B`: a complete digraph, and
`GraphAnalyzer.findCycles` (`src/graph/analyzer.ts:59-96`, skips only `imp.isExternal` /
empty `toPath`) reports it.

In a single-module repo these are intra-package 2-cycles that stay within one directory and
are easy to dismiss (dogfooding the 33-dep Android app did not flag them as a problem). They
turn damaging only when a clique member is a test file (3b) or the clique spans modules (3c),
i.e. once the loop crosses a boundary a reader cares about. Fixing 3b/3c removes the visible
pain; 3a still deserves the `isSamePackage` flag so structural analyses can opt out.

### 3d — narrow test classification

`classifyJvm` only treats a file as `test` when its path matches
`/src/(test|androidTest|integrationTest|it)/` or it imports one of a fixed framework-prefix
list (`src/parser/lang/jvm-scan.ts:9-19`). Repos with non-standard test roots, or
TestNG/AssertJ/Truth/Hamcrest-only tests, get misclassified as `logic`, which then feeds
real-looking edges into the graph and worsens 3a/3b.

## Fix plan

Priority order is **3b + 3c first** (partition the index) — that removes the cross-boundary
cycles dogfooding actually hit — then 3a's `isSamePackage` flag and 3d's classification
widening as follow-ups.

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

- `analyze` `cycles` on a JVM monorepo drops to genuine import cycles only — no `app ↔ app`
  or `app → lib → app` loops closed by a test file.
- `get_dependents` / `get_affected` no longer report production → test edges.
- Cross-module noise from shared package names (`util`, `model`, `di`) disappears.
- Single-module behaviour is unchanged (already usable).

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
