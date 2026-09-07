# Plan: `find_duplicates` noise reduction — JVM family (Kotlin / Java / Scala / Groovy)

Status: not started. Companion to `docs/plans/duplication-noise-reduction.md` (the parent plan,
driven by `box-ui-elements` = pure TS/JS) and to `docs/jvm-support-followups.md`. This doc is the
JVM half: the parent plan's items A / E were explicitly deferred pending calibration against a
Kotlin/Java repo, and there are three noise classes that only exist on JVM source.

Source: dogfood of `find_duplicates` against `square/okhttp` on 2026-09-05 (commit `dfcfab382`).
okhttp is a 34-module Gradle build, ~619 Kotlin + ~71 Java nodes.

## Measured baseline

`mokosh --find-duplicates --package <p> --limit 1000000 --min-duplicate-lines 6` run per module
across all 34 modules, then aggregated and deduped by occurrence set:

| metric | value |
|---|---|
| raw clusters (sum over 34 modules) | 43,795 |
| unique clusters (deduped by occurrence set) | 2,314 |
| unique, max-lines 6–9 | 1,713 (74%) |
| unique, max-lines 10–19 | 482 |
| unique, max-lines 20–39 | 101 |
| unique, max-lines 40–79 | 16 |
| unique, max-lines 80+ | 2 |

Genuinely actionable cross-file copy-paste after a human pass: **~2** (`ClientRuleEventListener`
↔ `LoggingEventListener`, 183 lines; `RequestTest` ↔ `RequestCommonTest`, 109 lines — and the
second is a source-set split, see item 2). Everything from rank 3 down is the
`@JvmName("-deprecated_…")` shim family, Kotlin builder/data-class idiom, or test scaffolding.

Two structural problems on top of the parent plan's "size ≠ information" root cause:

- **Monorepo re-runs.** 43,795 → 2,314 = **95% redundancy**. Every module's graph embeds okhttp
  core, so each core clone is re-found once per dependent module. There is no way to ask
  `find_duplicates` for "the whole workspace, deduped" — `--find-duplicates` with no
  `--package` errors on a monorepo root.
- **Weak cluster identity.** The aggregated set still contained near-duplicate rows the tool
  emitted separately: `CallKotlinTest ↔ CallTest` appeared as **3 clusters**, `DuplexTest ↔
  EventListenerTest` as 2, differing only by one occurrence span. This is the parent plan's
  item E, confirmed on JVM.

---

## Items, roughly ordered by leverage

### 1. Calibrate a non-zero `minScore` default for the `jvm` family (parent plan item A)

**Status of the mechanism:** `DuplicateGroup.score` (logic-bearing token count) already exists
and already ranks output — see ADR-019. `minScore` filtering is implemented but defaults to `0`
(off), because ADR-019 explicitly refused to ship a non-zero default until it was calibrated
against a non-JS repo: *"a JVM or Go block's keyword/operator density differs from TS's, and the
default must not silently drop real Go duplication."* okhttp is that calibration repo.

**What to do.** Re-run the sweep with `score` recorded per cluster, bucket the 2,314 unique
clusters by `score`, and find the knee. Hypotheses to check against the data:

- The 2 actionable clusters and the `RecordingConnectionListener ↔ EventRecorder` /
  `RequestBody ↔ ResponseBody` / `FakeSocket ↔ FakeServerSocket` tier should sit well above the
  cutoff.
- The `@JvmName("-deprecated_…")` shims (item 3) — a 6-line `@JvmName("-deprecated_foo") fun
  foo() = bar` block — should sit below it. Verify: these are almost pure `ID` + `.` + `=`,
  which ADR-019's metric already scores near zero, so a `minScore` in the 25–40 band may remove
  them without needing the annotation rule. If so, item 3 becomes belt-and-braces rather than
  load-bearing.
- Kotlin `data class` `copy(...)` / `equals`/`hashCode`/`toString` blocks: confirm these land
  low. `hashCode` with `31 * result + x.hashCode()` chains carry real operators — they may
  score higher than expected and need item 4.

**Deliverable.** A `duplication.minScore` default set per family (JS may keep `0`, `jvm` gets a
number), or a single default validated to be safe for both. Update ADR-019's "Consequences"
section and the parent plan's item A rollout note. Needs the `index.test.ts` JVM fixtures
re-baselined.

**Files.** `src/graph/duplication/index.ts` (default), `src/config.ts`, `docs/adr-019-*.md`.

### 2. Treat KMP source-set splits as identity, not duplication

**Problem.** `RequestTest.kt` (`src/jvmTest`) ↔ `RequestCommonTest.kt` (`src/commonTest`) is
rank 2 at 109 lines. `CacheControlJvmTest ↔ CacheControlTest` is rank 17. These are the
Kotlin-Multiplatform common/jvm/android source-set layout — the same logical test, compiled for
two targets — not copy-paste a maintainer would remove. Same argument for `expect`/`actual`
declaration pairs (okhttp core has 12).

**Fix.** A cluster whose occurrences are the *same relative path under different source-set
roots* of one module (`commonMain`↔`jvmMain`↔`androidMain`, `commonTest`↔`jvmTest`↔
`androidUnitTest`, or basename `X` ↔ `XCommonTest` / `XJvmTest` / `XAndroidTest`) is tagged
`signals: ["source-set-split"]` and dropped from default output, recoverable via `scope: "all"`
or a dedicated `includeSourceSetSplits` flag. Mirrors the existing `same-file` / `svg-markup` /
`test` signal machinery.

Source-set roots are already known to the JVM resolver (`src/graph/lang-resolvers/jvm.ts` keys
off a package-declaration index that handles KMP layouts — see `jvm-support-followups.md`).
Thread the source-set root + module id onto the node so the duplication pass can compare them.

**Files.** `src/graph/duplication/{shingle,index}.ts` (tag + filter), node metadata from the
resolver, `src/config.ts`, `src/mcp/{tools,handlers}.ts`, CLI `--scope` / new flag.

### 3. Annotation-driven exclusion of binary-compatibility shims

**Problem.** okhttp core carries **132 `@JvmName("-deprecated_…")` blocks across 19 files** —
Kotlin's idiom for keeping a removed getter callable from Java bytecode:

```kotlin
@JvmName("-deprecated_url")
@Deprecated(message = "moved to val", replaceWith = ReplaceWith("url"), level = DeprecationLevel.ERROR)
fun url(): HttpUrl = url
```

Every one of these is ~6 lines and near-identical in shape to every other. They inflate the
6–19 line buckets and produce the `HttpUrl ↔ CacheControl ↔ Cookie ↔ Address` cross-file
clusters (ranks 3–8) — which are *real* textual duplication but 100% deliberate and
un-actionable.

**Fix.** In the JVM scan (`src/parser/lang/jvm-scan.ts` already extracts annotation hints for
category classification — item 6 in `jvm-support-followups.md`), record byte ranges of members
annotated with any of: `@Deprecated(level = DeprecationLevel.HIDDEN | ERROR)` combined with
`@JvmName("-…")`, `@JvmSynthetic`, `@Generated` / `@javax.annotation.Generated`. A duplication
block whose span lies entirely inside such a range is tagged `signals: ["compat-shim"]` and
default-excluded.

Keep it narrow: `@Deprecated` *alone* (level `WARNING`) is normal API evolution and its body
can contain real logic — do not exclude that. The `@JvmName("-…")` + hidden/error level combo is
the specific "not real code" marker.

**Files.** `src/parser/lang/jvm-scan.ts` (emit shim ranges), `src/parser/lang/*kotlin*` /
`java.ts` to thread ranges into `ParseResult`, `src/graph/duplication/{shingle,index}.ts`.

### 4. Kotlin/Java idiom families — collapse to one summary row

**Problem.** After items 1–3 the residual is language idiom that a token matcher cannot
distinguish from copy-paste:

- **Builder / fluent setters** — `fun readTimeout(timeout: Duration) = apply { … }` repeated
  per field in `OkHttpClient.Builder`, `Request.Builder`, `Cookie.Builder`, `HttpUrl.Builder`,
  `MultipartBody.Builder`, `Address` (ranks 6–11 are almost all Builder-vs-Builder).
- **`data class` machinery** — hand-written `copy(...)`, `equals`, `hashCode` (`31 * result +
  …`), `toString` with the same field list shape across `Request`/`Response`/`Route`/`Handshake`
  (ranks 12, 13, 24, 31).
- **Guard prologues** — `require(x) { "…" }` / `check(...)` / `requireNotNull(...)` stacks at
  the top of constructors and factory functions.
- **`RequestBody` ↔ `ResponseBody` companion `create(...)` overload sets** (rank 21) — parallel
  by design.

**Fix.** Extend the clone-family machinery
(`docs/known_issues/09-duplicate-clone-family-noise.md`) with JVM idiom recognizers that run on
the normalized token run of a block:

| family tag | shape |
|---|---|
| `kotlin-builder-setter` | body is `= apply { this.<id> = <id> [; return this] }` or `{ this.<id> = <id>; return this }` |
| `kotlin-data-accessor` | `equals` / `hashCode` (`31 * … + ….hashCode()`) / `toString` (`"Type(field=$field, …)"`) / `copy(` with a param-per-field list |
| `jvm-guard-prologue` | ≥2 consecutive `require` / `check` / `requireNotNull` / `Objects.requireNonNull` calls, nothing else |
| `jvm-overload-set` | N functions with the same name, same body shape, differing only in one parameter type (companion `create`, static factories) |

A cluster that is entirely one family is emitted as a single summary finding
(`idiom: kotlin-builder-setter ×14 across 6 files`) instead of N clusters, default-collapsed,
expandable via `--include-idioms`.

**Files.** `src/graph/duplication/families.ts`, `src/graph/duplication/index.ts`, CLI/MCP wiring.

### 5. Workspace-wide dedup for `find_duplicates` on a monorepo

**Problem.** No single command answers "duplication across this whole Gradle build." Per-package
runs re-report every shared-graph clone once per dependent module (95% redundancy here); the
root run errors. `get_workspace_affected` already has module boundaries
(`src/graph/workspace/detectors/gradle.ts`, `jvm-support-followups.md` item 4).

**Fix.** `find_duplicates` on a workspace root (no `--package`): build the union graph once, run
detection once, and attribute each cluster to owning module(s) via the workspace boundary
annotation (`WorkspaceGraph.annotateCrossPackageEdges`). Output gains
`ownerPackages: string[]` per cluster; add a `crossPackageOnly` filter (duplication that spans
modules is the more interesting kind for a monorepo). Keep `--package <p>` as the
single-module scoped view.

**Files.** `src/graph/duplication/index.ts` (workspace entry path), `src/cli/commands/find-duplicates.ts`,
`src/mcp/{tools,handlers}.ts`, workspace graph plumbing.

### 6. One cluster per maximal shared block (parent plan item E — confirmed on JVM)

Nothing JVM-specific to add; the `CallKotlinTest ↔ CallTest` ×3 and `DuplexTest ↔
EventListenerTest` ×2 rows are the same combinatorial blow-up the parent plan describes. Listed
here only so the JVM dogfood numbers (2,314 unique would drop further under block-identity
bucketing) are attributed. Implement in the parent plan; re-measure here after.

---

## Expected effect on okhttp

| after | unique clusters (est.) |
|---|---|
| baseline (`--limit 1000000`, `--scope src`) | 2,314 |
| + item 1 (`minScore` ~30 for `jvm`) | ~150–250 |
| + item 2 (source-set splits) | drops rank 2, 17, ~15 more |
| + item 3 (compat shims) | drops ranks 3–8 tier, ~200 sub-threshold blocks |
| + item 4 (idiom families) | ranks 6–13, 21, 24, 31 collapse to ~4 summary rows |
| + item 5 (workspace dedup) | eliminates the 95% cross-module redundancy at source |
| **net default view** | **~15 genuine cross-file copy-paste clusters**, led by `ClientRuleEventListener ↔ LoggingEventListener` |

Each cluster also carries a `kind`: `copy-paste` | `idiom` | `source-set-split` | `compat-shim`
| `test-scaffold`, so filtered results stay reachable via `--all`.

## Dogfood corpus

- `square/okhttp` — Kotlin + Java, KMP source sets, `@JvmName` shim idiom, 34-module Gradle
  build. Primary for items 1–5.
- `Kotlin/kotlinx.coroutines` — heavier `expect`/`actual`, second KMP data point for item 2.
- `typelevel/cats` — Scala, confirm the `jvm` family recognizers do not over-fire on Scala
  given-instance boilerplate.
- `square/retrofit` — Java-only, confirm items 3–4 degrade cleanly with no Kotlin.

All permissive-licensed, parse-only.
