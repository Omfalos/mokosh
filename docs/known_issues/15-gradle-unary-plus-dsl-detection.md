# Issue 15 — Gradle monorepo detection misses settings files using Kotlin's unary-plus project DSL

Status: **shipped**. Found dogfooding v0.5.4 against ktorio/ktor.

## Symptom

`get_workspace_packages` and `analyze`'s monorepo auto-detection both reported ktorio/ktor as
"not a recognized monorepo root" (`detectMonorepo` returned `type: "none"`), despite it clearly
being a ~136-module Gradle multi-module build — confirmed by `analyze(entryPoints: [])`'s
full-repo scan (see issue 14) independently finding 3,210 Kotlin files across the repo.

## Root cause

`gradleDetector` (`src/graph/workspace/detectors/gradle.ts`) only recognized Gradle's standard
`include(":module")` / `include(":a", ":b")` call syntax. ktor's `settings.gradle.kts` uses a
custom settings-plugin DSL instead, built on Kotlin's unary-plus operator (the file's own comment:
*"We use custom DSL instead of the default `include(":project:path")` function... Use 'unaryPlus'
operator to declare a project"*):

```kotlin
projects {
    server {
        +"ktor-server-core"
        +"ktor-server-jetty" including {
            +"ktor-server-jetty-test-http2"
        }
        nested("ktor-server-plugins") {
            +"ktor-server-auth"
        }
    }
    shared {
        +"ktor-http"
    }
}
```

No `include(...)` call appears anywhere in the file, so `parseIncludes`'s regex scan found zero
modules and the detector returned `null`.

A second wrinkle, confirmed by inspecting the real directory layout: this DSL's module-name →
directory resolution isn't a fixed convention mokosh could reproduce by computing a path from the
DSL structure. The enclosing block name doesn't reliably become a directory prefix —
`+"ktor-server-core"` inside `server { }` resolves to `ktor-server/ktor-server-core` (nested one
level under a *differently-named* `ktor-server/` directory), while `+"ktor-http"` inside
`shared { }` resolves to a bare top-level `ktor-http/` with no `shared/` prefix at all. This
resolution is done by ktor's own `build-settings-logic`/`ktorsettings` Gradle plugin at build
time, not by anything mokosh can read statically from the settings file alone.

## Fix

`gradleDetector` now falls back to a second parser, `parseUnaryPlusIncludes`, when the standard
`include(...)` scan finds nothing: a regex for `+"module-name"`/`+'module-name'` tokens anywhere
in the file (deliberately not attempting to parse the `projects { server { ... } }` block
nesting or `including { }`/`nested(...)` structure — see the function's doc comment for why that
structure doesn't encode a reliable path anyway).

Since this fallback yields bare module names with no path, each is resolved to a real directory
by **basename search** instead of a computed path: `indexDirectoriesByBasename` walks the repo
once (bounded to 8 levels, skipping default-ignored directories) building a `basename → [every
directory with that name]` map, and each parsed module name is looked up in it. On a collision, a
directory with its own `build.gradle(.kts)` wins first (the strongest real "this is a Gradle
module" signal), then shortest path, then alphabetical — reviewer-flagged follow-up, closed in
the same change: pure shortest-path alone could pick an unrelated same-named directory over the
real, more-deeply-nested module. This is still best-effort, not exact — a module name with no
matching directory anywhere is silently skipped (same "module declared but not buildable from
what's on disk" tolerance the standard `include(...)` path already has for a stub/not-yet-created
module).

Standard `include(...)` parsing still takes precedence: the unary-plus fallback only runs when
the standard scan finds zero modules, so a normal Gradle settings file is completely unaffected.

## Test plan

- `src/graph/workspace/detectors/detectors.test.ts` (new "unary-plus DSL fallback" describe
  block): a bare top-level module; a module nested under a differently-named container directory
  (the exact `server { }` → `ktor-server/` shape); a module declared inside an `including { }`
  sub-block; standard `include(...)` still wins when both forms are present; a module name with
  no matching directory is silently skipped; `null` returned when nothing resolves; on a basename
  collision, a directory with its own `build.gradle(.kts)` wins over a shorter path without one.
- Manual, against the real ktorio/ktor checkout: `detectMonorepo` now returns `type: "gradle"`
  with 136 packages, correctly resolving both the nested case (`ktor-server-core` →
  `ktor-server/ktor-server-core`, 195 entry points) and the non-nested case (`ktor-http` → bare
  `ktor-http/`, 138 entry points) exactly matching the real directory layout. A full
  `createWorkspaceGraph` build against the real repo succeeds end-to-end.

## Cross-issue dependencies

None directly, though found during the same initial dogfooding pass as issue 14 (the
`analyze(entryPoints: [])` full-repo scan that first revealed ktor had real, discoverable Kotlin
source despite `get_workspace_packages` saying the repo wasn't a monorepo at all).
