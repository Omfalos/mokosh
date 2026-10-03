# Issue 22 — Gradle composite builds (`includeBuild`) are invisible to the workspace graph

Status: **shipped**. Raised from a user question ("can mokosh find cross-module refs without
running Gradle?") rather than a dogfooding run — scoped and written up before any fix, per
project convention. See "Shipped" below for what was actually built, which differs in one
respect from the "Decided approach" originally written (a `MokoshConfig` field instead of a CLI
flag / MCP arg — see that section for why).

## Symptom

A Gradle **composite build** — a root project that pulls in one or more other builds via
`includeBuild("path/to/other-build")` in `settings.gradle(.kts)`, a distinct mechanism from an
ordinary `include(":module")` sub-project — is not represented in mokosh's workspace model at
all:

- `gradleDetector` (`src/graph/workspace/detectors/gradle.ts`) only parses `include(...)` (and,
  as a fallback, the unary-plus DSL from issue 15). Its own doc comment for `parseIncludes`
  states plainly: `` `includeBuild(...)` (composite builds) uses filesystem paths, not `:` paths,
  so it is naturally excluded. `` No included build ever becomes a `WorkspacePackage`.
- If the included build's directory is **outside** the analyzed `rootDir` (the common real-world
  case — composite builds typically point at a sibling checkout, e.g.
  `includeBuild("../shared-lib")`), its source files never enter the graph at all: nothing in
  `createWorkspaceGraph` or `GraphBuilder` walks anything outside `rootDir`. A file in the main
  build that is coupled to a type in the included build has that coupling genuinely invisible —
  no import edge, no workspace package, no blast radius.
- If the included build happens to live **inside** `rootDir` (nested under the main repo), its
  source files are at least walked and can enter the graph as untagged, package-indexed JVM
  files — `JvmLangResolver`'s FQN resolution would still find them (it isn't scoped to declared
  packages, see below) — but the build is not recognized as a separate module: no
  `WorkspacePackage`, no `get_workspace_affected` cross-package attribution, no `package:<name>`
  query filter for it.

This is the one real case matching the "mokosh can't see cross-module refs without running
Gradle" claim: ordinary multi-module Gradle (`include(":a", ":b")`) is **not** affected — that
case is already solved without any Gradle invocation (see "Already works," below).

## Already works (don't re-litigate)

Per ADR-017 and `docs/plans/jvm-support-followups.md`: the import graph itself does not need
Gradle/sbt/javac to run at all. `JvmLangResolver` builds a project-wide package-declaration index
by reading the `package` line out of every JVM source file under `rootDir` and resolves FQN
imports against it — this is genuinely layout- and build-tool-independent, confirmed cross-module
on real multi-module repos (retrofit, ktor). Workspace *package boundaries* (for
`get_workspace_affected`, `package:<name>` queries) come from parsing `settings.gradle(.kts)`
text, not from invoking Gradle. Composite builds are the one case neither of these two mechanisms
covers, because `includeBuild` targets are never walked into the graph in the first place when
they're outside `rootDir`, and are never recognized as a package boundary even when they happen
to be inside it.

## Root cause

1. `parseIncludes`/`parseUnaryPlusIncludes` (`src/graph/workspace/detectors/gradle.ts`) have no
   `includeBuild(...)` parsing at all.
2. Even if parsed, an `includeBuild` target's path is frequently **outside** `rootDir`
   (`../other-repo`), and every path in the graph is `path.relative(rootDir, filePath)`
   (`src/graph/builder.ts`) — there is no mechanism today for a `GraphBuilder`/`WorkspaceGraph` to
   include files from outside one shared root.
3. `JvmLangResolver`'s package index (`buildPackageIndex`, `src/graph/lang-resolvers/jvm.ts`) is
   built by walking exactly one `rootDir`, cached per that root string — it has no notion of
   "also index this other directory."

## Decided approach

Two independent slices, shipped separately:

- **Phase 2 — in-root `includeBuild` detection.** `gradleDetector` parses `includeBuild("path")`
  targets; one resolving inside `rootDir` becomes an ordinary `WorkspacePackage`, identically to
  an `include(...)` module. One resolving outside `rootDir` is skipped — a single-root detector
  has no way to walk a directory it isn't scanning.
- **Phase 3 — an explicit extra-root option**, so a composite build's target *outside* `rootDir`
  can be named by the caller and merged into one analysis.

## Shipped

**Phase 2** (`src/graph/workspace/detectors/gradle.ts`): `parseIncludeBuilds` +
`resolveIncludeBuilds`, merged additively into `detect()`'s result alongside whichever of
`include(...)`/the unary-plus DSL fires (or on its own). Validated against a real repo
(`square/workflow-kotlin`, `includeBuild("build-logic")`): before the fix, `get_workspace_packages`
reported 2 packages with `build-logic` invisible; after, 3 packages with
`workflow-core.dependsOn: ["build-logic"]` correctly resolved — no Gradle invoked either time.

**Phase 3** (`src/index.ts`, `src/graph/lang-resolvers/jvm.ts`, `src/config.ts`): a new
`MokoshConfig.extraRoots: string[]` field — a config-file field, not a CLI flag / MCP arg, since
both the CLI and MCP `analyze` already pick up every graph-affecting `MokoshConfig` field
uniformly through the single `configToGraphOptions()` choke point (same mechanism `ignoreDirs`/
`pathAliases` already use) — no new CLI/MCP surface needed at all.

The actual implementation turned out simpler than "Root cause" above anticipated, because of one
thing the original analysis missed: **every package's `GraphBuilder` already uses the one shared
`rootDir` (`abs`)** — `path.relative(abs, filePath)` for a file genuinely outside `abs` just
produces a `..`-prefixed relative path, which is a perfectly valid, already-unique `Map` key and
`WorkspacePackage.relativeRoot` string. `WorkspaceGraph`'s existing `packageOwnsFile`/
`getPackageForFile`/`flatten()` string-prefix-match logic works on a `..`-leading `relativeRoot`
with **zero code changes** — no per-package custom `rootDir`, no path-namespacing pass in
`flatten()`, both of which the original plan assumed were necessary. The only real gap was
`JvmLangResolver`'s package index being scoped to exactly one `rootDir`:

1. `JvmLangResolver` constructor gains `extraRoots: string[]` (alongside the existing
   `extraIgnoreDirs`); `buildPackageIndex` walks `new Set([rootDir, ...extraRoots])` — self-dedup,
   so listing the same directory twice costs nothing extra.
2. `createWorkspaceGraph` resolves each `extraRoots` entry (relative entries against `rootDir`) to
   a `WorkspacePackage` via the existing `buildJvmPackage(abs, absExtraRoot, basename)` — reused
   unchanged, since `path.relative(abs, outsideDir)` already produces the right `..`-style
   `relativeRoot` — tagged `externalRoot: true`, and feeds every extra root into the one
   `sharedJvmResolver` so its index spans every tree. `workspaceMap` (for JS-style resolution) is
   still built from every package regardless of an `options.packages` filter, matching prior
   behavior.
3. `WorkspacePackage` gained `externalRoot?: boolean`, purely so a caller doesn't have to re-derive
   "is this outside the analyzed root" from the `relativeRoot` string shape.

Validated end-to-end via the real CLI (two independent temp directories, a `mokosh.config.json`
with `extraRoots`, no vitest mocking): an in-root Java file resolved a Kotlin type declared only
in the external directory (`--dependencies` showed `../external-lib/.../Shared.kt`), the reverse
direction resolved too (external file importing a main-tree type), `--workspace-packages` listed
the external directory as its own package (`relativeRoot: "../external-lib"`), and
`--workspace-affected` on the external file's path correctly reported the in-root file as
cross-package blast radius — all with no Gradle invocation.

**Known limitation (accepted):** mokosh analyzes only the root(s) a caller explicitly names — it
never auto-discovers an `includeBuild` target outside `rootDir` the way Gradle itself would
(Gradle reads the target's own `settings.gradle` recursively). A sibling checkout must be named
once via `extraRoots`, not rediscovered per run. Docs for an external root's own `.md` files
aren't picked up (`assignDocsToPackages` only walks `rootDir`'s project-file list); its own git
stats and lockfile-version data aren't read either (both are scoped to `rootDir`) — all
graceful-degradation gaps, not crashes, and not blocking for the primary ask (cross-module *code*
references resolving without Gradle).

## Test plan

- `src/graph/workspace/detectors/detectors.test.ts`: `includeBuild` parsed (both DSL forms),
  mixed with `include(...)`, in-root target becomes a normal package, in-root-only-declaration
  fires the detector alone, out-of-root target (relative and absolute) is skipped.
- `src/graph/lang-resolvers/jvm.test.ts`: without `extraRoots` a cross-root FQN is unresolvable;
  with it, resolution works in both directions; listing `rootDir` again in `extraRoots` doesn't
  duplicate results.
- `src/graph/workspace/shared-jvm-index.test.ts`: `createWorkspaceGraph` end-to-end — an extra
  root becomes its own `externalRoot: true` package with an escaping `relativeRoot`; cross-root
  resolution in both directions via `getPackageDependencies()`; a relative `extraRoots` entry
  resolves against `rootDir`; an extra root with no JVM sources is silently skipped; without
  `extraRoots` the external directory is invisible (regression guard for the "ordinary Gradle repo
  unaffected" case).
- Real-repo (Phase 2) and manual CLI (Phase 3) validation — see "Shipped" above.

## Cross-issue dependencies

- Builds on the same package-index mechanism issue 12's same-package call-edge fix already
  partitions by `(module, source-root)` (`jvmPathPartition`) — an extra root is a new, coarser
  scan-scope dimension, not a redesign of that mechanism.
- First feature in `known_issues/` to use `MokoshConfig` as the surface for a workspace-graph
  option rather than a per-call CLI flag/MCP arg — a precedent for any future cross-root or
  cross-repo option, since it reaches both CLI and MCP for free through `configToGraphOptions`.
