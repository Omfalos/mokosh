# ADR-023: On-demand coverage

**Date:** 2026-09-27
**Status:** Accepted

---

## Context

Coverage support previously required the user to run their own coverage tool ahead of time and
point `coverageReportPath` at the resulting Istanbul/v8 `coverage-summary.json`. Nothing in mokosh
ever generated that file — `find_uncovered`, `find_risk_hotspots`, and `query`'s
`minCoverage`/`maxCoverage` filter all silently did nothing (or errored) on any repo that hadn't
separately run coverage. This was also single-graph-only: `createWorkspaceGraph` never accepted a
`coverageMap` at all, so a monorepo got no coverage data whatsoever regardless of config, and the
CLI never wired `coverageReportPath` in either (only the MCP server did).

## Decision

### Opt-in, and two modes with a real speed/accuracy tradeoff

Nothing runs until `coverage.mode` is set in `MokoshConfig`; `coverageReportPath` (when set)
always takes priority over either mode. Real line coverage is only knowable by executing the
code — no static analysis can tell you "this line ran" without running it — so the two modes are
a genuine tradeoff, not one superseding the other:

- **`"static"` (recommended default)** — instant, zero-execution *estimate* from data already in
  the built graph (see "Static reachability estimate" below). Always safe to leave on: no process
  spawned, no side effects, no meaningful cost beyond a couple of graph traversals.
- **`"exec"`** — real coverage, by actually running each detected test runner. Accurate, but a
  side-effecting, potentially slow operation (network calls, DB writes, arbitrary build scripts) —
  use it deliberately (e.g. before a release), not as an always-on default.

Both write `coveragePct`; nodes also carry `coverageSource` (`"report"` or `"static"`) so a
consumer can tell a real measurement from an estimate.

### Static reachability estimate (`src/graph/coverage/static-estimate.ts`)

`computeStaticCoverage` scores every file by how directly it's reachable from a test file, using
graph data the build already produced — no process spawned, no disk cache needed (it's cheaper
than checking one):

| Tier | Score | Evidence |
|---|---|---|
| `DIRECT` | 100 | A test file imports this file directly (`testedBy`, from `enrichTestedBy`), or a test's call edges call one hop into it |
| `CALL_REACHABLE` | 75 | Reachable from a test via the *call* graph, transitively (`Graph.traverseCalls`) — a real function-call chain, not just an import statement. Only meaningful for languages with call edges (TS/JS, Go, Python, Java) |
| `IMPORT_REACHABLE` | 45 | The test transitively imports this file (`Graph.traverse`) but no traced call edge reaches it |
| `UNREACHED` | 0 | No test transitively imports this file at all |

This is explicitly an approximation: a `DIRECT`-scored file can still have untested branches, and
a call/import edge only proves the module loaded or a function was invoked once, not that its
logic was meaningfully exercised. It's most useful for what `find_uncovered` actually asks — "is
anything here completely untouched by tests" — where `UNREACHED` is a strong, cheap signal, and
weaker as a stand-in for a real coverage percentage.

### Runner-per-ecosystem (`coverage.mode: "exec"`, `src/graph/coverage/runners/`)

Each language/build-tool combination is one `CoverageRunner`: `detect(dir)` (cheap, synchronous —
manifest/config-file sniffing) and `run(dir, opts)` (spawns the tool, parses its native report
into a `dir`-relative `path → pct` map). A runner never throws; any failure — tool not installed,
tests failing, malformed output, timeout — degrades to "this runner contributed nothing", the same
contract `loadCoverageMap` already has for a missing/malformed report file.

| Runner | Detect | Run | Report format |
|---|---|---|---|
| `js` | `vitest`/`jest` in `package.json` deps, or their config files | `vitest run --coverage --coverage.reporter=json-summary` / `jest --coverage --coverageReporters=json-summary` | Istanbul json-summary — reuses the existing `loadCoverageMap` |
| `python` | `pytest.ini`/`pyproject.toml`/`setup.cfg`/`conftest.py`/`tox.ini` | `pytest --cov=. --cov-report=json:<file>` | `coverage.py`'s JSON report (`files.<path>.summary.percent_covered`) |
| `go` | `go.mod` | `go test ./... -coverprofile=<file>` | Raw coverprofile text, parsed directly (`parseGoCoverProfile`) — no `go tool cover` dependency |
| `gradle` | `build.gradle`/`build.gradle.kts` | `./gradlew test jacocoTestReport` (or `gradle`) | JaCoCo `jacocoTestReport.xml`, resolved against `src/main/{java,kotlin,scala,groovy}` (`parseJacocoReport`) |
| `sbt` | `build.sbt` | `sbt coverage test coverageReport` | sbt-scoverage `scoverage.xml`, a flat `<statement>` list aggregated to per-line coverage (`parseScoverageReport`) |

All matching runners for a directory run (a polyglot package runs every one that detects); each
process is spawned with `execFile` and an argv array — never a shell string — per the same
discipline as the `git.ts` command-injection fix.

### One scan root per monorepo package (`resolveCoverageScanRoots`)

A monorepo runs each package's own test suite in its own directory; a single-language repo runs
once at the root. Each runner's directory-relative map is merged into one project-root-relative
map by prefixing with the package's `relativeRoot`.

### Disk cache: `mokosh-cache/coverage-result.json`

One file for the whole repo/workspace (not per-package — unlike the duplication result cache,
there's no separate-invalidation win here since every package's suite already runs together in one
pass). Keyed by a digest of every graph node's `path`/`mtime`/`size` (`digestNodes`, factored out
of `duplicationDigest` so both caches share the exact same unit) plus a params key over
`timeoutMs`/`packages`. A digest match skips re-running every test suite entirely; any change
reruns all of them — same "no partial re-run" honesty the duplication result cache already
documents, since one changed file can only be resolved by actually re-running the suite.

### Post-build enrichment, not a `GraphBuilder` input

Earlier coverage flowed in as a `coverageMap` argument to `GraphBuilder`, loaded before the build
started. On-demand coverage instead runs as a step *after* the graph (or `WorkspaceGraph`) is
built — `getOrRunCoverage` reads the already-built nodes' `mtime`/`size` for its digest (no second
filesystem walk) and calls the existing `enrichCoverage(nodes, map)` directly. This is also what
makes monorepo support possible: `WorkspaceGraph.flatten()` already produces one merged,
by-reference node set to enrich in place, whereas `createWorkspaceGraph` has no `coverageMap`
parameter at all.

### Recompute triggers

Both modes run from the same choke points that already handle "rebuild on file change":
`SessionState.getOrBuild`/`getOrBuildWorkspace` (MCP — reached by
`ensureFresh`/`ensureFreshWorkspace` off the file watcher) and the CLI's `applyConfiguredCoverage`
(called after every build, including each `--watch` rebuild). `"static"` just recomputes fresh
every time (cheap enough that caching it isn't worth the complexity); `"exec"`'s digest check
(above) is what makes recomputing there cheap on a no-op rebuild instead of rerunning every suite.

## Consequences

- `coverageReportPath` behavior is unchanged and still the only path CLI users had working before
  this — CLI now also wires it (previously only the MCP server did).
- Coverage now works on monorepos for the first time, via `WorkspaceGraph.flatten()`.
- A `gradle`/`sbt` runner both require the project to already carry the relevant coverage plugin
  (`jacoco`, `sbt-scoverage`); when absent, the build step fails and the runner contributes
  nothing — mokosh does not inject build-tool plugins into the analyzed project.
- Every runner spawns a real, potentially long test run; `coverage.timeoutMs` (default 5 minutes)
  bounds each one independently so one hung package doesn't block the others indefinitely.
